import 'dotenv/config';
import 'reflect-metadata';
import next from 'next';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { config } from './lib/config';
import { ensureDatabaseReady, closeDatabase } from './lib/db';
import {
  applyCorsForApi,
  defaultHelmet,
  loginLimiter,
  oauthLimiter,
  parseBearer,
  registerLimiter,
  requireTrustedOrigin,
} from './lib/security';
import { attachSessionContext, requireCsrf, requireSession } from './lib/middleware/session';
import {
  createSession,
  clearSessionCookie,
  issueSessionCookie,
  renewSession,
  revokeSession,
} from './lib/sessions';
import { requestIp, requestUserAgent, safeReturnTo } from './lib/http';
import {
  assertPhoneRegistrationAllowed,
  authenticateUser,
  readActiveUserByPhone,
  readActiveUserByRandId,
  readUserLoginCapabilities,
  readUserSecurityState,
  registerUser,
  registerUserByPhone,
} from './lib/services/auth';
import { bootstrapAuthDefaults } from './lib/services/bootstrap';
import {
  createTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactorWithCode,
  getUserProfileSnapshot,
  updateProfileDetails,
  updateProfilePassword,
} from './lib/services/profile';
import {
  assertScopeAllowed,
  consumeAuthorizationCode,
  createAccessToken,
  createAuthorizationCode,
  parseClientAuth,
  readAccessToken,
  readClientById,
  resolveTenantPolicyByClientId,
  validateAuthorizeRedirect,
  validateTenantSsoTokenForClient,
  verifyClientSecret,
} from './lib/oauth';
import { logActivity } from './lib/activity';
import { issueOtpChallenge, verifyOtpChallenge } from './lib/services/otp';
import { normalizeTotpCode, verifyTotpCode } from './lib/services/totp';
import { applyTenantSync } from './lib/services/tenant-sync';
import { assertCode, normalizeText } from './lib/validation';
import {
  createOrUpdateWhitelistTenant,
  deleteWhitelistTenant,
  extractTenantNameFromRedirectUri,
  listWhitelist,
  normalizeTenantName,
  rotateWhitelistTenantToken,
  verifyTenantSsoToken,
} from './lib/services/tenant-whitelist';
import { removeManagedAvatarFromDisk, saveAvatarDataUrlToDisk, saveAvatarToDisk } from './lib/services/avatar-storage';
import { safeEqual } from './lib/crypto';
import { provisionTenantSso } from './lib/services/tenant-provisioning';
import {
  assignTenantOrganization,
  assignUserOrganization,
  assignUserRole,
  listOrganizations,
  listRoles,
  listTenantOrganizationMappings,
  listUsersWithAssignments,
  resolveOrganizationSubtree,
  resolveTenantOrganizationScope,
  upsertOrganization,
  upsertRole,
} from './lib/services/access-admin';
import { resolveTenantOrgContext, upsertUserTenantMembership } from './lib/services/user-tenant-context';
import { getTenantOrgDirectory, getTenantOu, getTenantUsersByOu } from './lib/services/tenant-directory';

const dev = config.nodeEnv !== 'production';
const nextApp = next({ dev, dir: __dirname });
const nextHandler = nextApp.getRequestHandler();

const appendQuery = (url: string, key: string, value: string | null | undefined): string => {
  if (!value) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return fallback;
};

const toLoginFriendlyError = (message: string): string => {
  const normalized = String(message || '').trim().toLowerCase();
  if (
    normalized.includes('tenant_name must match redirect_uri host tenant') ||
    normalized.includes('tenant callback is not mapped to this oauth client') ||
    normalized.includes('tenant callback host is not whitelisted') ||
    normalized.includes('tenant is not mapped to this oauth client') ||
    normalized.includes('tenant is not whitelisted for sso')
  ) {
    return 'Tenant configuration mismatch. Start sign in again from the same tenant URL.';
  }
  return message;
};

const encodeErrorParam = (error: unknown): string => encodeURIComponent(toErrorMessage(error, 'Unexpected error'));

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

const optionalTenantOrgRandId = (value: unknown): string => {
  const raw = optionalString(value, 64);
  return raw;
};

const readEntityTenantOrgRandId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { tenantOrgRandId?: unknown }).tenantOrgRandId;
  const normalized = optionalTenantOrgRandId(raw);
  return normalized || null;
};

const readTenantServiceToken = (req: Request): string => {
  const fromHeader = optionalString(req.headers['x-tenant-sso-token'], 512);
  if (fromHeader) return fromHeader;
  const fromBody = optionalString(req.body?.tenant_sso_token || req.body?.tenantSsoToken, 512);
  if (fromBody) return fromBody;
  const fromQuery = optionalString(req.query?.tenant_sso_token || req.query?.tenantSsoToken, 512);
  if (fromQuery) return fromQuery;
  return parseBearer(req.headers.authorization);
};

const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

const readRequestBuffer = async (req: Request, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Avatar file is too large. Maximum size is 2 MB.') as Error & { statusCode: number };
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const appendAuthContext = (
  baseUrl: string,
  {
    returnTo,
    clientId,
    tenantName,
    tenantOrgRandId,
  }: {
    returnTo: string;
    clientId?: string;
    tenantName?: string;
    tenantOrgRandId?: string;
  },
): string => {
  let location = `${baseUrl}?returnTo=${encodeURIComponent(returnTo)}`;
  if (clientId) location = appendQuery(location, 'client_id', clientId);
  if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
  if (tenantOrgRandId) location = appendQuery(location, 'tenant_org_id', tenantOrgRandId);
  return location;
};

type LoginUiMode = 'signin' | 'signup';
type LoginUiSignupStep = 'start' | 'verify';

interface LoginUiState {
  mode?: LoginUiMode;
  signinMethod?: 'password' | 'otp';
  signinStep?: 'method' | 'phone' | 'password' | 'otp' | 'twofactor';
  signupStep?: LoginUiSignupStep;
  require2fa?: boolean;
  otpWaitUntilMs?: number;
  phoneNumber?: string;
  success?: string;
  error?: string;
}

interface LoginTwoFactorPendingState {
  userRandId: string;
  returnTo: string;
  clientId?: string;
  tenantName?: string;
  tenantOrgRandId?: string;
  expiresAt: number;
}

const LOGIN_UI_STATE_COOKIE = 'idp_login_ui_state';
const LOGIN_2FA_PENDING_COOKIE = 'idp_login_2fa_pending';
const LOGIN_2FA_PENDING_TTL_MS = 5 * 60 * 1000;

const loginUiCookieOptions = {
  path: '/',
  httpOnly: true,
  signed: true,
  sameSite: config.cookie.sameSite,
  secure: config.cookie.secure,
  domain: config.cookie.domain,
};

const setLoginUiState = (res: Response, state: LoginUiState): void => {
  const payload = JSON.stringify(state);
  res.cookie(LOGIN_UI_STATE_COOKIE, payload, { ...loginUiCookieOptions, maxAge: 5 * 60 * 1000 });
};

const clearLoginUiState = (res: Response): void => {
  res.clearCookie(LOGIN_UI_STATE_COOKIE, loginUiCookieOptions);
};

const setLoginTwoFactorPending = (
  res: Response,
  state: Omit<LoginTwoFactorPendingState, 'expiresAt'>,
): void => {
  const expiresAt = Date.now() + LOGIN_2FA_PENDING_TTL_MS;
  const payload = JSON.stringify({
    ...state,
    expiresAt,
  });
  res.cookie(LOGIN_2FA_PENDING_COOKIE, payload, {
    ...loginUiCookieOptions,
    maxAge: LOGIN_2FA_PENDING_TTL_MS,
  });
};

const clearLoginTwoFactorPending = (res: Response): void => {
  res.clearCookie(LOGIN_2FA_PENDING_COOKIE, loginUiCookieOptions);
};

const readLoginTwoFactorPending = (req: Request): LoginTwoFactorPendingState | null => {
  const raw = req.signedCookies?.[LOGIN_2FA_PENDING_COOKIE];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as LoginTwoFactorPendingState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.userRandId || !parsed.returnTo || !Number.isFinite(parsed.expiresAt)) return null;
    if (Date.now() >= parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
};

const wantsJson = (req: Request): boolean => {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('application/json')) return true;
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json');
};

const requireInternalApiToken = (
  req: Request,
  res: Response,
  next: express.NextFunction,
): void => {
  const configuredToken = config.internalApi.token;
  if (!configuredToken) {
    res.status(503).json({ error: 'Internal provisioning API is not configured' });
    return;
  }

  const bearer = parseBearer(req.headers.authorization);
  if (!bearer || !safeEqual(bearer, configuredToken)) {
    res.status(401).json({ error: 'Invalid internal API token' });
    return;
  }

  next();
};

const hostFromAbsoluteUrl = (value: string): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname || null;
  } catch {
    return null;
  }
};

const hostFromOriginHeader = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return hostFromAbsoluteUrl(value);
};

const tenantHostFromReturnTo = (returnTo: string): string | null => {
  if (!returnTo || !returnTo.startsWith('/')) return null;
  try {
    const parsed = new URL(returnTo, 'http://local.auth');
    const redirectUri = parsed.searchParams.get('redirect_uri') || '';
    return hostFromAbsoluteUrl(redirectUri);
  } catch {
    return null;
  }
};

const resolveTenantHostForCookie = (req: Request, returnTo?: string): string | null => {
  const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
  if (tenantName) return tenantName;

  const redirectUri =
    optionalString(req.body.redirect_uri || req.query.redirect_uri, 2048) ||
    optionalString(req.body.callback_url || req.query.callback_url, 2048);
  const fromRedirect = hostFromAbsoluteUrl(redirectUri);
  if (fromRedirect) return fromRedirect;

  const fromReturnTo = returnTo ? tenantHostFromReturnTo(returnTo) : null;
  if (fromReturnTo) return fromReturnTo;

  const fromOrigin = hostFromOriginHeader(req.headers.origin);
  if (fromOrigin) return fromOrigin;

  const fromReferer = hostFromOriginHeader(req.headers.referer);
  return fromReferer || null;
};

const requiresAuthenticatorTwoFactor = (security: ReturnType<typeof readUserSecurityState>): boolean =>
  Boolean(security.twoFactorEnabled && security.twoFactorMethod === 'app' && security.twoFactorSecret);

const isAuthAdmin = (req: Request): boolean => {
  const meta = (req.sessionContext?.user?.meta || {}) as Record<string, unknown>;
  return meta.authAdmin === true;
};

const requireAuthAdminApi = (req: Request, res: Response): boolean => {
  if (!req.sessionContext || !isAuthAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
};

const renewSessionHandler = async (req: Request, res: Response, next: express.NextFunction): Promise<void> => {
  try {
    if (!req.sessionContext) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    await renewSession(req.sessionContext.session.randId);
    const signedToken = req.signedCookies?.[config.cookie.name];
    if (signedToken) {
      issueSessionCookie(req, res, signedToken, resolveTenantHostForCookie(req));
    }

    await logActivity({
      eventType: 'auth.session.renewed',
      actorUserRandId: req.sessionContext.user.randId,
      targetType: 'auth_session',
      targetRandId: req.sessionContext.session.randId,
      ipAddress: requestIp(req),
      userAgent: requestUserAgent(req),
    });

    res.status(200).json({
      ok: true,
      renewedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

const boot = async (): Promise<void> => {
  await ensureDatabaseReady();
  if (config.bootstrap.onStart) {
    await bootstrapAuthDefaults({
      log: (message) => {
        console.log(message);
      },
    });
  }
  await nextApp.prepare();

  const app = express();

  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');
  app.use(defaultHelmet);
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser(config.session.secret));
  app.use('/api', applyCorsForApi);
  app.use(attachSessionContext);

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'auth', env: config.nodeEnv });
  });

  app.post('/api/internal/tenant-sso/register', requireInternalApiToken, async (req, res, next) => {
    try {
      const tenantName = normalizeTenantName(optionalString(req.body?.tenant_name || req.body?.tenantName, 255));
      const tenantRandId = optionalString(req.body?.tenant_rand_id || req.body?.tenantRandId, 64);
      if (!tenantRandId) {
        res.status(400).json({ error: 'tenant_rand_id is required' });
        return;
      }

      const allowRegistrationRaw = req.body?.allow_registration ?? req.body?.allowRegistration;
      const allowRegistration =
        typeof allowRegistrationRaw === 'boolean'
          ? allowRegistrationRaw
          : String(allowRegistrationRaw ?? 'true').trim().toLowerCase() !== 'false';

      const rotateCredentialsRaw = req.body?.rotate_credentials ?? req.body?.rotateCredentials;
      const rotateCredentials =
        typeof rotateCredentialsRaw === 'boolean'
          ? rotateCredentialsRaw
          : String(rotateCredentialsRaw ?? 'false').trim().toLowerCase() === 'true';

      const result = await provisionTenantSso({
        tenantName,
        tenantRandId,
        allowRegistration,
        tenantDisplayName: optionalString(req.body?.tenant_display_name || req.body?.tenantDisplayName, 180) || null,
        callbackUrl: optionalString(req.body?.callback_url || req.body?.callbackUrl, 2048) || null,
        rotateCredentials,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/public/register-policy', async (req, res, next) => {
    try {
      const clientId = optionalString(req.query.client_id, 120);
      const tenantName =
        optionalString(req.query.tenant_name, 255) ||
        hostFromAbsoluteUrl(optionalString(req.query.redirect_uri, 2048)) ||
        '';
      if (!clientId) {
        res.json({ allowRegistration: true, tenant: null });
        return;
      }

      const resolved = await resolveTenantPolicyByClientId(clientId, tenantName || null);
      if (!resolved) {
        res.status(404).json({ allowRegistration: false, error: 'Unknown tenant client' });
        return;
      }

      res.json({
        allowRegistration: resolved.policy.allowRegistration,
        source: resolved.policy.source,
        tenant: {
          randId: resolved.policy.tenantRandId,
          code: resolved.policy.tenantCode,
          name: resolved.policy.tenantDisplayName,
          tenantName: resolved.policy.tenantName,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/public/login-options', async (req, res, next) => {
    try {
      const phoneNumber = optionalString(req.query.phone_number, 32);
      if (!phoneNumber) {
        res.status(400).json({ error: 'phone_number is required' });
        return;
      }

      const user = await readActiveUserByPhone(phoneNumber);
      if (!user) {
        res.status(404).json({ exists: false });
        return;
      }

      const capabilities = readUserLoginCapabilities(user);
      res.status(200).json({
        exists: true,
        phoneNumber: user.phoneNumber,
        methods: {
          password: capabilities.passwordEnabled,
          otp: true,
        },
        defaultMethod: capabilities.passwordEnabled ? 'password' : 'otp',
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/public/login-ui-state', (req, res) => {
    const raw = req.signedCookies?.[LOGIN_UI_STATE_COOKIE];
    clearLoginUiState(res);
    res.setHeader('Cache-Control', 'no-store');

    if (typeof raw !== 'string' || !raw.trim()) {
      res.status(200).json({ state: {} });
      return;
    }

    try {
      const parsed = JSON.parse(raw) as LoginUiState;
      res.status(200).json({ state: parsed || {} });
    } catch {
      res.status(200).json({ state: {} });
    }
  });

  app.get('/api/tenant-directory/org', oauthLimiter, async (req, res, next) => {
    try {
      const tenantName = optionalString(req.query.tenant_name || req.headers['x-tenant-name'], 255);
      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required' });
        return;
      }

      const tenantSsoToken = readTenantServiceToken(req);
      if (!tenantSsoToken) {
        res.status(401).json({ error: 'tenant_sso_token is required' });
        return;
      }

      const tenantEntry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
      if (!tenantEntry) {
        res.status(401).json({ error: 'Invalid tenant token' });
        return;
      }

      const payload = await getTenantOrgDirectory(tenantEntry.tenantName);
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/tenant-directory/ou', oauthLimiter, async (req, res, next) => {
    try {
      const tenantName = optionalString(req.query.tenant_name || req.headers['x-tenant-name'], 255);
      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required' });
        return;
      }

      const tenantSsoToken = readTenantServiceToken(req);
      if (!tenantSsoToken) {
        res.status(401).json({ error: 'tenant_sso_token is required' });
        return;
      }

      const tenantEntry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
      if (!tenantEntry) {
        res.status(401).json({ error: 'Invalid tenant token' });
        return;
      }

      const ouPath = optionalString(req.query.ou_path || req.query.ouPath, 512);
      const payload = await getTenantOu(tenantEntry.tenantName, ouPath);
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/tenant-directory/users', oauthLimiter, async (req, res, next) => {
    try {
      const tenantName = optionalString(req.query.tenant_name || req.headers['x-tenant-name'], 255);
      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required' });
        return;
      }

      const tenantSsoToken = readTenantServiceToken(req);
      if (!tenantSsoToken) {
        res.status(401).json({ error: 'tenant_sso_token is required' });
        return;
      }

      const tenantEntry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
      if (!tenantEntry) {
        res.status(401).json({ error: 'Invalid tenant token' });
        return;
      }

      const ouPath = optionalString(req.query.ou_path || req.query.ouPath, 512);
      const payload = await getTenantUsersByOu(tenantEntry.tenantName, ouPath);
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/session', async (req, res) => {
    if (!req.sessionContext) {
      res.status(200).json({ authenticated: false });
      return;
    }

    res.status(200).json({
      authenticated: true,
      csrfToken: req.sessionContext.session.csrfToken,
      user: {
        randId: req.sessionContext.user.randId,
        email: req.sessionContext.user.email,
        firstName: req.sessionContext.user.firstName,
        lastName: req.sessionContext.user.lastName,
        isAuthAdmin: isAuthAdmin(req),
      },
      tenantRandId: req.sessionContext.session.tenantRandId,
    });
  });

  app.get('/api/profile', requireSession, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const profile = await getUserProfileSnapshot(userRandId);
      res.status(200).json({ profile });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile/avatar/upload', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const contentType = String(req.headers['content-type'] || '')
        .split(';')[0]
        ?.trim()
        .toLowerCase();
      if (!contentType) {
        res.status(400).json({ error: 'Avatar content type is required' });
        return;
      }

      const avatar = await readRequestBuffer(req, AVATAR_UPLOAD_MAX_BYTES);
      const avatarUrl = await saveAvatarToDisk(userRandId, avatar, contentType);
      res.status(200).json({ ok: true, avatarUrl });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile/details', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const firstName = optionalString(req.body.firstName ?? req.body.first_name, 120);
      const lastName = optionalString(req.body.lastName ?? req.body.last_name, 120);
      const nationalId = optionalString(req.body.nationalId ?? req.body.national_id, 96);
      const phoneNumber = optionalString(req.body.phoneNumber ?? req.body.phone_number, 32);

      if (!firstName || !lastName || !nationalId) {
        res.status(400).json({ error: 'firstName, lastName, and nationalId are required' });
        return;
      }

      if (!phoneNumber) {
        res.status(400).json({ error: 'phoneNumber is required' });
        return;
      }

      const previousAvatar = (await getUserProfileSnapshot(userRandId)).user.avatarUrl;
      const avatarRaw = req.body.avatarUrl ?? req.body.avatar_url ?? undefined;
      let normalizedAvatar: string | null | undefined = avatarRaw;
      if (typeof avatarRaw === 'string' && avatarRaw.trim().toLowerCase().startsWith('data:image/')) {
        normalizedAvatar = await saveAvatarDataUrlToDisk(userRandId, avatarRaw, AVATAR_UPLOAD_MAX_BYTES);
      }

      await updateProfileDetails(
        userRandId,
        {
          firstName,
          lastName,
          nationalId,
          phoneNumber,
          avatarUrl: normalizedAvatar,
          birthday: req.body.birthday ?? req.body.birth_day ?? undefined,
          gender: req.body.gender ?? undefined,
        },
        userRandId,
      );

      await logActivity({
        eventType: 'auth.profile.updated',
        actorUserRandId: userRandId,
        targetType: 'user',
        targetRandId: userRandId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      const profile = await getUserProfileSnapshot(userRandId);
      if (previousAvatar && previousAvatar !== profile.user.avatarUrl) {
        try {
          await removeManagedAvatarFromDisk(previousAvatar);
        } catch (avatarError) {
          console.warn('[auth] failed to remove old avatar file', avatarError);
        }
      }
      res.status(200).json({ ok: true, profile });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile/password', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const currentPassword = String(req.body.currentPassword ?? req.body.current_password ?? '');
      const newPassword = String(req.body.newPassword ?? req.body.new_password ?? '');
      const confirmPassword = String(req.body.confirmPassword ?? req.body.confirm_password ?? '');

      if (!newPassword || !confirmPassword) {
        res.status(400).json({ error: 'New password and confirmation are required' });
        return;
      }

      if (newPassword !== confirmPassword) {
        res.status(400).json({ error: 'New password and confirmation do not match' });
        return;
      }

      await updateProfilePassword(userRandId, currentPassword, newPassword, userRandId);

      await logActivity({
        eventType: 'auth.profile.password.updated',
        actorUserRandId: userRandId,
        targetType: 'user',
        targetRandId: userRandId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile/2fa/setup', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const setup = await createTwoFactorSetup(userRandId, userRandId);

      await logActivity({
        eventType: 'auth.profile.2fa.setup.created',
        actorUserRandId: userRandId,
        targetType: 'user',
        targetRandId: userRandId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ ok: true, setup });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile/2fa/enable', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const verificationCode = optionalString(
        req.body.verificationCode ?? req.body.verification_code ?? req.body.code,
        16,
      );
      await enableTwoFactorWithCode(userRandId, verificationCode, userRandId);

      await logActivity({
        eventType: 'auth.profile.2fa.enabled',
        actorUserRandId: userRandId,
        targetType: 'user',
        targetRandId: userRandId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      const profile = await getUserProfileSnapshot(userRandId);
      res.status(200).json({ ok: true, security: profile.security });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/profile/2fa/disable', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      await disableTwoFactor(userRandId, userRandId);

      await logActivity({
        eventType: 'auth.profile.2fa.disabled',
        actorUserRandId: userRandId,
        targetType: 'user',
        targetRandId: userRandId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      const profile = await getUserProfileSnapshot(userRandId);
      res.status(200).json({ ok: true, security: profile.security });
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/login/otp/start', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const tenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const requestedSigninStep = optionalString(req.body.signin_step || req.query.signin_step, 24).toLowerCase();

    try {
      const user = await readActiveUserByPhone(phoneNumber);
      if (!user) {
        if (wantsJson(req)) {
          res.status(404).json({ error: 'Account not found' });
          return;
        }

        setLoginUiState(res, {
          mode: 'signin',
          signinMethod: 'otp',
          signinStep: requestedSigninStep === 'otp' ? 'otp' : 'phone',
          phoneNumber,
          error: 'Account not found',
        });
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
        return;
      }

      const challenge = await issueOtpChallenge({
        purpose: 'login_otp',
        destinationPhone: user.phoneNumber,
        payload: { userRandId: user.randId, phoneNumber: user.phoneNumber },
      });

      await logActivity({
        eventType: 'auth.login.otp.challenge.sent',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { expiresAt: challenge.expiresAt.toISOString() },
      });

      if (wantsJson(req)) {
        res.status(202).json({
          ok: true,
          requiresOtp: true,
          phoneNumber: user.phoneNumber,
          resendAvailableAt: challenge.resendAvailableAt.toISOString(),
          ...(config.isDevelopment ? { otpDebugCode: challenge.code } : {}),
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signin',
        signinMethod: 'otp',
        signinStep: 'otp',
        phoneNumber: user.phoneNumber,
        otpWaitUntilMs: challenge.resendAvailableAt.getTime(),
        success: config.isDevelopment
          ? `OTP sent. Dev OTP: ${challenge.code}`
          : 'OTP sent to your phone',
      });
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
    } catch (error) {
      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'OTP request failed',
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signin',
        signinMethod: 'otp',
        signinStep: requestedSigninStep === 'otp' ? 'otp' : 'phone',
        phoneNumber,
        otpWaitUntilMs:
          typeof (error as { retryAfterAt?: unknown }).retryAfterAt === 'number'
            ? (error as { retryAfterAt: number }).retryAfterAt
            : undefined,
        error: toErrorMessage(error, 'OTP request failed'),
      });
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
    }
  });

  app.post('/auth/login/otp/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const tenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const otpCode = optionalString(req.body.otp_code || req.body.otpCode || req.query.otp_code, 12);

    try {
      const user = await readActiveUserByPhone(phoneNumber);
      if (!user) {
        throw new Error('Account not found');
      }

      const verified = await verifyOtpChallenge({
        purpose: 'login_otp',
        destinationPhone: user.phoneNumber,
        code: otpCode,
      });

      const payloadUserRandId = optionalString(verified.payload.userRandId, 64);
      if (payloadUserRandId && payloadUserRandId !== user.randId) {
        const error = new Error('OTP challenge does not match this account');
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      const security = readUserSecurityState(user);
      if (requiresAuthenticatorTwoFactor(security)) {
        setLoginTwoFactorPending(res, {
          userRandId: user.randId,
          returnTo,
          clientId: clientId || undefined,
          tenantName: tenantName || undefined,
          tenantOrgRandId: tenantOrgRandId || undefined,
        });

        if (wantsJson(req)) {
          res.status(202).json({
            ok: false,
            requiresTwoFactor: true,
            twoFactorMethod: 'authenticator',
            message: 'Enter authenticator verification code',
          });
          return;
        }

        setLoginUiState(res, {
          mode: 'signin',
          signinMethod: 'otp',
          signinStep: 'twofactor',
          require2fa: true,
          phoneNumber: user.phoneNumber,
          success: 'Enter authenticator verification code',
        });
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
        return;
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      clearLoginTwoFactorPending(res);
      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      if (tenantName) {
        const tenantContext = await resolveTenantOrgContext({
          tenantName,
          tenantOrgRandId: tenantOrgRandId || null,
        });
        await upsertUserTenantMembership({
          userRandId: user.randId,
          tenantName: tenantContext.tenantName || tenantName,
          tenantRandId: tenantContext.tenantRandId,
          orgRandId: tenantContext.effectiveOrgRandId,
          source: 'login',
          actorUserRandId: user.randId,
          actorTenantRandId: tenantContext.tenantRandId || null,
        });
      }

      await logActivity({
        eventType: 'auth.login.otp.success',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      if (wantsJson(req)) {
        res.status(200).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'Login failed',
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signin',
        signinMethod: 'otp',
        signinStep: 'otp',
        phoneNumber,
        otpWaitUntilMs:
          typeof (error as { retryAfterAt?: unknown }).retryAfterAt === 'number'
            ? (error as { retryAfterAt: number }).retryAfterAt
            : undefined,
        error: toErrorMessage(error, 'Login failed'),
      });
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
    }
  });

  const completeTwoFactorLogin = async (req: Request, res: Response): Promise<void> => {
    const requestReturnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const requestClientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const requestTenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const requestTenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const verificationCode = normalizeTotpCode(
      optionalString(
        req.body.verification_code ??
          req.body.verificationCode ??
          req.body.two_factor_code ??
          req.body.twoFactorCode ??
          req.body.otp_code ??
          req.body.otpCode,
        16,
      ),
    );

    try {
      const pending = readLoginTwoFactorPending(req);
      if (!pending) {
        const error = new Error('2FA login session expired. Start login again.');
        (error as Error & { statusCode: number }).statusCode = 401;
        throw error;
      }

      if (verificationCode.length !== config.totp.digits) {
        const error = new Error(`Verification code must be ${config.totp.digits} digits`);
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      const effectiveUser = await readActiveUserByRandId(pending.userRandId);
      if (!effectiveUser) {
        const error = new Error('Account not found');
        (error as Error & { statusCode: number }).statusCode = 404;
        throw error;
      }

      const security = readUserSecurityState(effectiveUser);
      if (!requiresAuthenticatorTwoFactor(security) || !security.twoFactorSecret) {
        const error = new Error('2FA is not configured for this account');
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      const valid = verifyTotpCode({
        secret: security.twoFactorSecret,
        code: verificationCode,
      });
      if (!valid) {
        const error = new Error('Invalid authenticator verification code');
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }

      const returnTo = pending.returnTo || requestReturnTo;
      const clientId = pending.clientId || requestClientId;
      const tenantName = pending.tenantName || requestTenantName;
      const tenantOrgRandId = pending.tenantOrgRandId || requestTenantOrgRandId;

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: effectiveUser.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      clearLoginTwoFactorPending(res);
      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      if (tenantName) {
        const tenantContext = await resolveTenantOrgContext({
          tenantName,
          tenantOrgRandId: tenantOrgRandId || null,
        });
        await upsertUserTenantMembership({
          userRandId: effectiveUser.randId,
          tenantName: tenantContext.tenantName || tenantName,
          tenantRandId: tenantContext.tenantRandId,
          orgRandId: tenantContext.effectiveOrgRandId,
          source: 'login',
          actorUserRandId: effectiveUser.randId,
          actorTenantRandId: tenantContext.tenantRandId || null,
        });
      }

      await logActivity({
        eventType: 'auth.login.2fa.success',
        actorUserRandId: effectiveUser.randId,
        targetType: 'user',
        targetRandId: effectiveUser.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      if (wantsJson(req)) {
        res.status(200).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode || 400;
      if (statusCode >= 401) {
        clearLoginTwoFactorPending(res);
      }
      if (wantsJson(req)) {
        res.status(statusCode).json({
          error: error instanceof Error ? error.message : '2FA verification failed',
        });
        return;
      }

      setLoginUiState(res, {
        mode: 'signin',
        signinMethod: 'password',
        signinStep: 'twofactor',
        require2fa: true,
        error: toErrorMessage(error, '2FA verification failed'),
      });
      res.redirect(
        appendAuthContext('/login', {
          returnTo: requestReturnTo,
          clientId: requestClientId,
          tenantName: requestTenantName,
          tenantOrgRandId: requestTenantOrgRandId || undefined,
        }),
      );
    }
  };

  app.post('/auth/login/two-factor/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    await completeTwoFactorLogin(req, res);
  });

  app.post('/auth/login/password/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    await completeTwoFactorLogin(req, res);
  });

  app.post('/auth/login', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const tenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);

    try {
      const user = await authenticateUser({
        phoneNumber,
        password: String(req.body.password || ''),
      });

      if (!user) {
        await logActivity({
          eventType: 'auth.login.failed',
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { phoneNumber },
        });

        if (wantsJson(req)) {
          res.status(401).json({ error: 'Invalid credentials' });
          return;
        }

        res.redirect(
          (() => {
            setLoginUiState(res, {
              mode: 'signin',
              signinMethod: 'password',
              signinStep: 'password',
              phoneNumber,
              error: 'Invalid credentials',
            });
            return appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId });
          })(),
        );
        return;
      }

      const security = readUserSecurityState(user);
      if (requiresAuthenticatorTwoFactor(security)) {
        setLoginTwoFactorPending(res, {
          userRandId: user.randId,
          returnTo,
          clientId: clientId || undefined,
          tenantName: tenantName || undefined,
          tenantOrgRandId: tenantOrgRandId || undefined,
        });

        await logActivity({
          eventType: 'auth.login.2fa.required',
          actorUserRandId: user.randId,
          targetType: 'user',
          targetRandId: user.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { method: 'authenticator' },
        });

        if (wantsJson(req)) {
          res.status(202).json({
            ok: false,
            requiresTwoFactor: true,
            twoFactorMethod: 'authenticator',
            message: 'Enter authenticator verification code',
          });
          return;
        }

        setLoginUiState(res, {
          mode: 'signin',
          signinMethod: 'password',
          signinStep: 'twofactor',
          require2fa: true,
          phoneNumber: user.phoneNumber,
          success: 'Enter authenticator verification code',
        });
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
        return;
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      clearLoginTwoFactorPending(res);
      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      if (tenantName) {
        const tenantContext = await resolveTenantOrgContext({
          tenantName,
          tenantOrgRandId: tenantOrgRandId || null,
        });
        await upsertUserTenantMembership({
          userRandId: user.randId,
          tenantName: tenantContext.tenantName || tenantName,
          tenantRandId: tenantContext.tenantRandId,
          orgRandId: tenantContext.effectiveOrgRandId,
          source: 'login',
          actorUserRandId: user.randId,
          actorTenantRandId: tenantContext.tenantRandId || null,
        });
      }

      await logActivity({
        eventType: 'auth.login.success',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      if (wantsJson(req)) {
        res.status(200).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'Login failed',
        });
        return;
      }

      const message = toErrorMessage(error, 'Login failed');
      res.redirect(
        (() => {
          const isTwoFactorError = message.toLowerCase().includes('2fa') || message.toLowerCase().includes('verification code');
          setLoginUiState(res, {
            mode: 'signin',
            signinMethod: 'password',
            signinStep: isTwoFactorError ? 'twofactor' : 'password',
            require2fa: isTwoFactorError,
            phoneNumber,
            error: message,
          });
          return appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId });
        })(),
      );
    }
  });

  app.post('/auth/register/start', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const tenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const requestedSignupStep = optionalString(req.body.signup_step || req.query.signup_step, 16).toLowerCase();

    try {
      const tenantContext = tenantName
        ? await resolveTenantOrgContext({ tenantName, tenantOrgRandId: tenantOrgRandId || null })
        : { tenantName: null, tenantRandId: null, effectiveOrgRandId: null };
      const normalizedPhone = await assertPhoneRegistrationAllowed({
        phoneNumber,
        clientId: clientId || undefined,
        tenantName: tenantContext.tenantName || tenantName || undefined,
      });

      const challenge = await issueOtpChallenge({
        purpose: 'signup',
        destinationPhone: normalizedPhone,
        payload: {
          clientId: clientId || null,
          tenantName: tenantContext.tenantName || tenantName || null,
          tenantRandId: tenantContext.tenantRandId || null,
          tenantOrgRandId: tenantContext.effectiveOrgRandId || null,
        },
      });

      await logActivity({
        eventType: 'auth.register.otp.sent',
        targetType: 'user',
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: {
          phoneNumber: normalizedPhone,
          expiresAt: challenge.expiresAt.toISOString(),
          clientId: clientId || null,
          tenantName: tenantContext.tenantName || tenantName || null,
          tenantRandId: tenantContext.tenantRandId || null,
          tenantOrgRandId: tenantContext.effectiveOrgRandId || null,
        },
      });

      if (wantsJson(req)) {
        res.status(202).json({
          ok: true,
          requiresOtp: true,
          phoneNumber: normalizedPhone,
          resendAvailableAt: challenge.resendAvailableAt.toISOString(),
          ...(config.isDevelopment ? { otpDebugCode: challenge.code } : {}),
        });
        return;
      }

      res.redirect(
        (() => {
          setLoginUiState(res, {
            mode: 'signup',
            signupStep: 'verify',
            otpWaitUntilMs: challenge.resendAvailableAt.getTime(),
            phoneNumber: normalizedPhone,
            success: config.isDevelopment
              ? `OTP sent. Dev OTP: ${challenge.code}`
              : 'OTP sent. Enter the code to complete signup.',
          });
          return appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId });
        })(),
      );
    } catch (error) {
      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'OTP request failed',
        });
        return;
      }

      res.redirect(
        (() => {
          setLoginUiState(res, {
            mode: 'signup',
            signupStep: requestedSignupStep === 'verify' ? 'verify' : 'start',
            otpWaitUntilMs:
              typeof (error as { retryAfterAt?: unknown }).retryAfterAt === 'number'
                ? (error as { retryAfterAt: number }).retryAfterAt
                : undefined,
            phoneNumber,
            error: toErrorMessage(error, 'OTP request failed'),
          });
          return appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId });
        })(),
      );
    }
  });

  app.post('/auth/register/complete', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const tenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const otpCode = optionalString(req.body.otp_code || req.body.otpCode || req.query.otp_code, 12);

    try {
      const verified = await verifyOtpChallenge({
        purpose: 'signup',
        destinationPhone: phoneNumber,
        code: otpCode,
      });

      const payloadTenantName = optionalString(verified.payload.tenantName, 255);
      const payloadTenantRandId = optionalString(verified.payload.tenantRandId, 64) || null;
      const payloadTenantOrgRandId = optionalTenantOrgRandId(verified.payload.tenantOrgRandId);
      const effectiveTenantName = payloadTenantName || tenantName || '';
      const requestedTenantOrgRandId = tenantOrgRandId || payloadTenantOrgRandId;
      const tenantContext = effectiveTenantName
        ? await resolveTenantOrgContext({
            tenantName: effectiveTenantName,
            tenantOrgRandId: requestedTenantOrgRandId || null,
          })
        : { tenantName: null, tenantRandId: payloadTenantRandId || null, effectiveOrgRandId: requestedTenantOrgRandId || null };

      const user = await registerUserByPhone({
        phoneNumber,
        clientId: clientId || undefined,
        tenantName: tenantContext.tenantName || effectiveTenantName || undefined,
      });

      if (tenantContext.tenantName) {
        await upsertUserTenantMembership({
          userRandId: user.randId,
          tenantName: tenantContext.tenantName,
          tenantRandId: tenantContext.tenantRandId || payloadTenantRandId || null,
          orgRandId: tenantContext.effectiveOrgRandId || null,
          source: 'signup',
          actorUserRandId: user.randId,
          actorTenantRandId: tenantContext.tenantRandId || payloadTenantRandId || null,
        });

        if (tenantContext.effectiveOrgRandId) {
          await assignUserOrganization({
            userRandId: user.randId,
            orgRandId: tenantContext.effectiveOrgRandId,
            isAssignmentActive: true,
            actorUserRandId: user.randId,
          });
        }
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      await logActivity({
        eventType: 'auth.register.success',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { via: 'phone_otp' },
      });

      if (wantsJson(req)) {
        res.status(201).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      await logActivity({
        eventType: 'auth.register.failed',
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: {
          message: error instanceof Error ? error.message : 'register_failed',
          phoneNumber,
          clientId,
          flow: 'phone_otp',
        },
      });

      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'Registration failed',
        });
        return;
      }

      res.redirect(
        (() => {
          setLoginUiState(res, {
            mode: 'signup',
            signupStep: 'verify',
            phoneNumber,
            error: toErrorMessage(error, 'Registration failed'),
          });
          return appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId });
        })(),
      );
    }
  });

  app.post('/auth/register', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const tenantOrgRandId = optionalTenantOrgRandId(
      req.body.tenant_org_id || req.body.tenantOrgRandId || req.query.tenant_org_id || req.query.tenantOrgRandId,
    );
    const authUi = optionalString(req.body.auth_ui, 32).toLowerCase();

    try {
      const tenantContext = tenantName
        ? await resolveTenantOrgContext({ tenantName, tenantOrgRandId: tenantOrgRandId || null })
        : { tenantName: null, tenantRandId: null, effectiveOrgRandId: null };
      const user = await registerUser({
        email: String(req.body.email || ''),
        password: String(req.body.password || ''),
        firstName: String(req.body.first_name || req.body.firstName || ''),
        lastName: String(req.body.last_name || req.body.lastName || ''),
        nationalId: String(req.body.national_id || req.body.nationalId || ''),
        phoneNumber: String(req.body.phone_number || req.body.phoneNumber || ''),
        clientId: clientId || undefined,
        tenantName: tenantContext.tenantName || tenantName || undefined,
      });

      if (tenantContext.tenantName) {
        await upsertUserTenantMembership({
          userRandId: user.randId,
          tenantName: tenantContext.tenantName,
          tenantRandId: tenantContext.tenantRandId || null,
          orgRandId: tenantContext.effectiveOrgRandId || null,
          source: 'signup',
          actorUserRandId: user.randId,
          actorTenantRandId: tenantContext.tenantRandId || null,
        });

        if (tenantContext.effectiveOrgRandId) {
          await assignUserOrganization({
            userRandId: user.randId,
            orgRandId: tenantContext.effectiveOrgRandId,
            isAssignmentActive: true,
            actorUserRandId: user.randId,
          });
        }
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

      await logActivity({
        eventType: 'auth.register.success',
        actorUserRandId: user.randId,
        targetType: 'user',
        targetRandId: user.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      if (wantsJson(req)) {
        res.status(201).json({ ok: true, returnTo, csrfToken: sessionEntity.csrfToken });
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      await logActivity({
        eventType: 'auth.register.failed',
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: {
          message: error instanceof Error ? error.message : 'register_failed',
          email: String(req.body.email || '').toLowerCase(),
          clientId,
        },
      });

      if (wantsJson(req)) {
        res.status((error as { statusCode?: number }).statusCode || 400).json({
          error: error instanceof Error ? error.message : 'Registration failed',
        });
        return;
      }

      const useLoginUi = authUi === 'login';
      if (useLoginUi) {
        setLoginUiState(res, {
          mode: 'signup',
          error: toErrorMessage(error, 'Registration failed'),
          phoneNumber: optionalString(req.body.phone_number || req.body.phoneNumber || '', 32),
        });
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName, tenantOrgRandId }));
        return;
      }

      let location = `/register?error=${encodeErrorParam(error)}&returnTo=${encodeURIComponent(returnTo)}`;
      if (clientId) location = appendQuery(location, 'client_id', clientId);
      if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
      if (tenantOrgRandId) location = appendQuery(location, 'tenant_org_id', tenantOrgRandId);
      res.redirect(location);
    }
  });

  app.post('/auth/logout', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      if (req.sessionContext) {
        await revokeSession(req.sessionContext.session.randId);
        await logActivity({
          eventType: 'auth.logout',
          actorUserRandId: req.sessionContext.user.randId,
          targetType: 'user',
          targetRandId: req.sessionContext.user.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });
      }

      clearSessionCookie(req, res, resolveTenantHostForCookie(req));
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/auth/renew', requireTrustedOrigin, requireSession, requireCsrf, renewSessionHandler);
  app.post('/api/session/renew', requireTrustedOrigin, requireSession, requireCsrf, renewSessionHandler);

  app.get('/oauth/authorize', oauthLimiter, async (req, res) => {
    const respondAuthorizeError = (statusCode: number, errorMessage: string): void => {
      if (wantsJson(req)) {
        res.status(statusCode).json({ error: errorMessage });
        return;
      }

      const clientIdHint = optionalString(req.query.client_id, 120);
      const tenantNameHint =
        optionalString(req.query.tenant_name, 255) ||
        hostFromAbsoluteUrl(optionalString(req.query.redirect_uri, 2048)) ||
        '';
      const tenantOrgRandIdHint = optionalTenantOrgRandId(
        req.query.tenant_org_id || req.query.tenantOrgRandId,
      );

      setLoginUiState(res, {
        mode: 'signin',
        error: toLoginFriendlyError(errorMessage),
      });
      res.redirect(
        appendAuthContext('/login', {
          returnTo: '/profile',
          clientId: clientIdHint || undefined,
          tenantName: tenantNameHint || undefined,
          tenantOrgRandId: tenantOrgRandIdHint || undefined,
        }),
      );
    };

    try {
      const responseType = optionalString(req.query.response_type, 16);
      const clientId = assertCode(req.query.client_id, 'client_id');
      const redirectUri = optionalString(req.query.redirect_uri, 2048);
      const tenantNameHintRaw = optionalString(req.query.tenant_name, 255);
      const tenantNameHint = tenantNameHintRaw ? normalizeTenantName(tenantNameHintRaw) : '';
      const tenantOrgRandIdHint = optionalTenantOrgRandId(req.query.tenant_org_id || req.query.tenantOrgRandId);
      const scopeRaw = optionalString(req.query.scope, 2000);
      const state = optionalString(req.query.state, 4096);
      const codeChallenge = optionalString(req.query.code_challenge, 256);
      const codeChallengeMethod = optionalString(req.query.code_challenge_method, 16);

      if (responseType !== 'code') {
        respondAuthorizeError(400, 'Only authorization code flow is supported');
        return;
      }

      const client = await readClientById(clientId);
      if (!client || !client.isActive) {
        respondAuthorizeError(400, 'Unknown client_id');
        return;
      }

      const redirectContext = await validateAuthorizeRedirect(client, redirectUri);
      if (tenantNameHint && tenantNameHint !== redirectContext.tenantName) {
        respondAuthorizeError(400, 'tenant_name must match redirect_uri host tenant');
        return;
      }
      const tenantContext = await resolveTenantOrgContext({
        tenantName: redirectContext.tenantName,
        tenantOrgRandId: tenantOrgRandIdHint || null,
      });
      const scope = assertScopeAllowed(client, scopeRaw);

      if (client.requirePkce && !codeChallenge) {
        respondAuthorizeError(400, 'PKCE is required for this client');
        return;
      }

      if (!req.sessionContext) {
        const returnTo = safeReturnTo(req.originalUrl, '/login');
        const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}&client_id=${encodeURIComponent(
          clientId,
        )}&tenant_name=${encodeURIComponent(redirectContext.tenantName)}${
          tenantContext.effectiveOrgRandId
            ? `&tenant_org_id=${encodeURIComponent(tenantContext.effectiveOrgRandId)}`
            : ''
        }`;
        res.redirect(loginUrl);
        return;
      }

      const code = await createAuthorizationCode({
        clientId,
        tenantRandId: client.tenantRandId,
        tenantName: redirectContext.tenantName,
        tenantOrgRandId: tenantContext.effectiveOrgRandId || null,
        userRandId: req.sessionContext.user.randId,
        redirectUri,
        scope,
        codeChallenge: codeChallenge || null,
        codeChallengeMethod: codeChallengeMethod || null,
        state: state || null,
      });

      await logActivity({
        eventType: 'oauth.code.issued',
        actorUserRandId: req.sessionContext.user.randId,
        actorTenantRandId: client.tenantRandId,
        targetType: 'oauth_client',
        targetRandId: client.randId,
        oauthClientId: client.clientId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { scope },
      });

      let callback = appendQuery(redirectUri, 'code', code);
      callback = appendQuery(callback, 'state', state || null);
      res.redirect(callback);
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode || 400;
      const message = error instanceof Error ? error.message : 'authorize_failed';
      respondAuthorizeError(statusCode, message);
    }
  });

  app.post('/oauth/token', oauthLimiter, async (req, res) => {
    try {
      const grantType = optionalString(req.body.grant_type, 40);
      if (grantType !== 'authorization_code') {
        res.status(400).json({ error: 'Unsupported grant_type' });
        return;
      }

      const { clientId, clientSecret } = parseClientAuth(req);
      const client = await readClientById(clientId);

      if (!client || !client.isActive) {
        res.status(401).json({ error: 'Invalid client credentials' });
        return;
      }

      const secretOk = await verifyClientSecret(client, clientSecret);
      if (!secretOk) {
        await logActivity({
          eventType: 'oauth.token.failed',
          actorTenantRandId: client.tenantRandId,
          oauthClientId: client.clientId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { reason: 'invalid_client_secret' },
        });

        res.status(401).json({ error: 'Invalid client credentials' });
        return;
      }

      const code = optionalString(req.body.code, 512);
      const redirectUri = optionalString(req.body.redirect_uri, 2048);
      const codeVerifier = optionalString(req.body.code_verifier, 256);
      const tenantNameFromBodyRaw = optionalString(req.body.tenant_name, 255);
      const tenantNameFromBody = tenantNameFromBodyRaw
        ? normalizeTenantName(tenantNameFromBodyRaw)
        : '';
      const tenantOrgRandIdFromBody = optionalTenantOrgRandId(
        req.body.tenant_org_id || req.body.tenantOrgRandId || req.headers['x-tenant-org-id'],
      );
      const tenantNameFromRedirect = redirectUri ? extractTenantNameFromRedirectUri(redirectUri) : '';
      if (tenantNameFromBody && tenantNameFromRedirect && tenantNameFromBody !== tenantNameFromRedirect) {
        res.status(400).json({ error: 'tenant_name must match redirect_uri host tenant' });
        return;
      }
      const tenantName = tenantNameFromBody || tenantNameFromRedirect;
      const tenantSsoToken = optionalString(
        req.body.tenant_sso_token || req.headers['x-tenant-sso-token'],
        512,
      );

      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required for token exchange' });
        return;
      }

      await validateTenantSsoTokenForClient({
        tenantName,
        tenantSsoToken,
        client,
      });

      const authorizationCode = await consumeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });

      if (authorizationCode.tenantName !== tenantName) {
        res.status(400).json({ error: 'tenant_name mismatch for authorization code' });
        return;
      }
      const authorizationCodeTenantOrgRandId = readEntityTenantOrgRandId(authorizationCode);
      if (
        tenantOrgRandIdFromBody &&
        authorizationCodeTenantOrgRandId &&
        authorizationCodeTenantOrgRandId !== tenantOrgRandIdFromBody
      ) {
        res.status(400).json({ error: 'tenant_org_id mismatch for authorization code' });
        return;
      }

      const token = await createAccessToken({
        clientId,
        tenantRandId: authorizationCode.tenantRandId,
        tenantName: authorizationCode.tenantName,
        tenantOrgRandId: authorizationCodeTenantOrgRandId,
        userRandId: authorizationCode.userRandId,
        scope: authorizationCode.scope,
        grantType,
        ipAddress: requestIp(req),
      });

      await logActivity({
        eventType: 'oauth.token.issued',
        actorUserRandId: authorizationCode.userRandId,
        actorTenantRandId: authorizationCode.tenantRandId,
        oauthClientId: client.clientId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
        payload: { scope: authorizationCode.scope },
      });

      // OAuth responses should use snake_case fields. Keep camelCase aliases for backward compatibility.
      res.status(200).json({
        access_token: token.accessToken,
        token_type: token.tokenType,
        expires_in: token.expiresIn,
        scope: token.scope,
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        expiresIn: token.expiresIn,
      });
    } catch (error) {
      res.status((error as { statusCode?: number }).statusCode || 400).json({
        error: error instanceof Error ? error.message : 'token_failed',
      });
    }
  });

  app.get('/oauth/userinfo', oauthLimiter, async (req, res) => {
    const token = parseBearer(req.headers.authorization);
    const context = await readAccessToken(token);
    if (!context) {
      res.status(401).json({ error: 'Invalid access token' });
      return;
    }

    const clientMeta = (context.client.meta || {}) as Record<string, unknown>;
    let roleCodes: string[] = [];
    let roleDetails: Array<{
      role_rand_id: string;
      role_code: string;
      role_name: string;
      org_rand_id: string;
      org_name: string | null;
    }> = [];
    let organizations: Array<{
      org_rand_id: string;
      org_code: string;
      org_name: string;
    }> = [];

    const tokenTenantOrgRandId = readEntityTenantOrgRandId(context.token);

    if (context.user?.randId) {
      const profile = await getUserProfileSnapshot(context.user.randId);
      roleDetails = profile.roles
        .filter((role) => role.isAssignmentActive)
        .map((role) => ({
          role_rand_id: role.roleRandId,
          role_code: role.roleCode,
          role_name: role.roleName,
          org_rand_id: role.orgRandId,
          org_name: role.orgName,
        }));
      organizations = profile.organizations
        .filter((org) => org.isAssignmentActive)
        .map((org) => ({
          org_rand_id: org.orgRandId,
          org_code: org.orgCode,
          org_name: org.orgName,
        }));

      const tenantScope = await resolveTenantOrganizationScope(context.token.tenantName);
      if (tokenTenantOrgRandId) {
        const tenantContext = await resolveTenantOrgContext({
          tenantName: context.token.tenantName,
          tenantOrgRandId: tokenTenantOrgRandId,
        });
        if (tenantContext.effectiveOrgRandId) {
          const orgSubtree = await resolveOrganizationSubtree(tenantContext.effectiveOrgRandId);
          const allowedOrgIds =
            tenantScope.rootOrgRandId
              ? new Set(Array.from(orgSubtree).filter((orgId) => tenantScope.orgIds.has(orgId)))
              : orgSubtree;
          organizations = organizations.filter((org) => allowedOrgIds.has(org.org_rand_id));
          roleDetails = roleDetails.filter((role) => allowedOrgIds.has(role.org_rand_id));
        }
      } else if (tenantScope.rootOrgRandId) {
        organizations = organizations.filter((org) => tenantScope.orgIds.has(org.org_rand_id));
        roleDetails = roleDetails.filter((role) => tenantScope.orgIds.has(role.org_rand_id));
      }

      roleCodes = Array.from(
        new Set(
          roleDetails
            .map((role) => role.role_code.trim())
            .filter(Boolean),
        ),
      );
    }

    res.status(200).json({
      sub: context.user?.randId || null,
      email: context.user?.email || null,
      given_name: context.user?.firstName || null,
      family_name: context.user?.lastName || null,
      role: roleCodes[0] || null,
      role_code: roleCodes[0] || null,
      roles: roleCodes,
      role_details: roleDetails,
      organizations,
      groups: roleCodes,
      tenant_rand_id: context.token.tenantRandId,
      tenant_name: context.token.tenantName,
      tenant_org_rand_id: tokenTenantOrgRandId,
      tenant_code: typeof clientMeta.tenantCode === 'string' ? clientMeta.tenantCode : null,
      client_id: context.token.clientId,
      scope: context.token.scope,
    });
  });

  app.post('/api/tenant-sync/upsert', oauthLimiter, async (req, res, next) => {
    try {
      const bearer = parseBearer(req.headers.authorization);
      const context = await readAccessToken(bearer);

      if (!context) {
        res.status(401).json({ error: 'Invalid access token' });
        return;
      }

      const scopes = context.token.scope.split(/\s+/).filter(Boolean);
      if (!scopes.includes('tenant.sync')) {
        res.status(403).json({ error: 'tenant.sync scope is required' });
        return;
      }

      const table = optionalString(req.body.table, 64) as
        | 'users'
        | 'roles'
        | 'organizations'
        | 'user_roles'
        | 'user_orgs';
      const allowedTables = new Set([
        'users',
        'roles',
        'organizations',
        'user_roles',
        'user_orgs',
      ]);
      if (!allowedTables.has(table)) {
        res.status(400).json({ error: 'Unsupported table' });
        return;
      }

      const randId = optionalString(req.body.rand_id || req.body.randId, 64);
      if (!randId) {
        res.status(400).json({ error: 'rand_id is required' });
        return;
      }

      const changes = req.body.changes;
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        res.status(400).json({ error: 'changes must be an object' });
        return;
      }

      const result = await applyTenantSync(
        {
          table,
          randId,
          changes,
          reason: normalizeText(req.body.reason || 'tenant-sync', 200),
          actorUserRandId: optionalString(req.body.actor_user_rand_id || req.body.actorUserRandId, 64) ||
            context.token.userRandId ||
            undefined,
        },
        context.token.tenantRandId,
      );

      await logActivity({
        eventType: 'tenant.sync.upsert',
        actorUserRandId: context.token.userRandId,
        actorTenantRandId: context.token.tenantRandId,
        targetType: table,
        targetRandId: randId,
        oauthClientId: context.token.clientId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/tenant-whitelist', requireSession, async (req, res) => {
    if (!isAuthAdmin(req)) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const rows = await listWhitelist();
    res.status(200).json({
      items: rows.map((row) => ({
        tenantName: row.tenantName,
        tenantRandId: row.tenantRandId,
        isActive: row.isActive,
        meta: row.meta || {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
  });

  app.post(
    '/api/admin/tenant-whitelist',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
    try {
      if (!isAuthAdmin(req)) {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }

      const tenantName = normalizeTenantName(optionalString(req.body.tenant_name, 255));
      const tenantRandId = optionalString(req.body.tenant_rand_id, 64) || null;
      const isActive =
        typeof req.body.is_active === 'boolean' ? req.body.is_active : String(req.body.is_active) !== 'false';
      const allowRegistration = String(req.body.allow_registration || '').toLowerCase() !== 'false';
      const tenantDisplayName = optionalString(req.body.tenant_display_name, 180) || null;

      const { row, plainToken } = await createOrUpdateWhitelistTenant({
        tenantName,
        tenantRandId,
        isActive,
        token: optionalString(req.body.sso_token, 512) || undefined,
        meta: {
          allowRegistration,
          ...(tenantDisplayName ? { tenantDisplayName } : {}),
        },
      });

      await logActivity({
        eventType: 'admin.whitelist.upsert',
        actorUserRandId: req.sessionContext?.user.randId || null,
        targetType: 'tenant_whitelist',
        targetRandId: tenantName,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({
        item: {
          tenantName: row.tenantName,
          tenantRandId: row.tenantRandId,
          isActive: row.isActive,
          meta: row.meta || {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        generatedToken: plainToken,
      });
    } catch (error) {
      next(error);
    }
    },
  );

  app.post(
    '/api/admin/tenant-whitelist/:tenantName/rotate-token',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!isAuthAdmin(req)) {
          res.status(403).json({ error: 'Admin access required' });
          return;
        }

        const tenantName = normalizeTenantName(req.params.tenantName);
        const { row, plainToken } = await rotateWhitelistTenantToken(tenantName);

        await logActivity({
          eventType: 'admin.whitelist.rotate_token',
          actorUserRandId: req.sessionContext?.user.randId || null,
          targetType: 'tenant_whitelist',
          targetRandId: tenantName,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({
          item: {
            tenantName: row.tenantName,
            tenantRandId: row.tenantRandId,
            isActive: row.isActive,
            meta: row.meta || {},
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          generatedToken: plainToken,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.delete(
    '/api/admin/tenant-whitelist/:tenantName',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!isAuthAdmin(req)) {
          res.status(403).json({ error: 'Admin access required' });
          return;
        }

        const tenantName = normalizeTenantName(req.params.tenantName);
        await deleteWhitelistTenant(tenantName);

        await logActivity({
          eventType: 'admin.whitelist.delete',
          actorUserRandId: req.sessionContext?.user.randId || null,
          targetType: 'tenant_whitelist',
          targetRandId: tenantName,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/api/admin/access/organizations', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const items = await listOrganizations();
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/access/roles', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const items = await listRoles();
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/access/tenant-mappings', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const items = await listTenantOrganizationMappings();
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/access/users', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const page = Number(req.query.page);
      const limit = Number(req.query.limit);
      const search = optionalString(req.query.search, 200) || undefined;
      const tenantName = optionalString(req.query.tenant_name || req.query.tenantName, 255) || undefined;
      const tenantOrgRandId =
        optionalString(req.query.tenant_org_rand_id || req.query.tenantOrgRandId, 64) || undefined;
      const result = await listUsersWithAssignments({
        page: Number.isFinite(page) ? page : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        search,
        tenantName,
        tenantOrgRandId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    '/api/admin/access/organizations',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!requireAuthAdminApi(req, res)) return;
        const actorUserRandId = req.sessionContext!.user.randId;
        const item = await upsertOrganization({
          randId: optionalString(req.body.rand_id || req.body.randId, 64) || undefined,
          name: optionalString(req.body.name, 180),
          code: optionalString(req.body.code, 96),
          parentOrgRandId:
            optionalString(req.body.parent_org_rand_id || req.body.parentOrgRandId, 64) || null,
          isActive:
            typeof req.body.is_active === 'boolean'
              ? req.body.is_active
              : typeof req.body.isActive === 'boolean'
                ? req.body.isActive
                : undefined,
          actorUserRandId,
        });

        await logActivity({
          eventType: 'admin.access.org.upsert',
          actorUserRandId,
          targetType: 'organization',
          targetRandId: item.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/access/roles',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!requireAuthAdminApi(req, res)) return;
        const actorUserRandId = req.sessionContext!.user.randId;
        const item = await upsertRole({
          randId: optionalString(req.body.rand_id || req.body.randId, 64) || undefined,
          roleName: optionalString(req.body.role_name || req.body.roleName, 160),
          roleCode: optionalString(req.body.role_code || req.body.roleCode, 96),
          orgRandId: optionalString(req.body.org_rand_id || req.body.orgRandId, 64),
          isActive:
            typeof req.body.is_active === 'boolean'
              ? req.body.is_active
              : typeof req.body.isActive === 'boolean'
                ? req.body.isActive
                : undefined,
          actorUserRandId,
        });

        await logActivity({
          eventType: 'admin.access.role.upsert',
          actorUserRandId,
          targetType: 'role',
          targetRandId: item.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/access/tenant-mappings',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!requireAuthAdminApi(req, res)) return;
        const actorUserRandId = req.sessionContext!.user.randId;
        const item = await assignTenantOrganization({
          tenantName: optionalString(req.body.tenant_name || req.body.tenantName, 255),
          organizationRandId:
            optionalString(req.body.organization_rand_id || req.body.organizationRandId, 64) || null,
        });

        await logActivity({
          eventType: 'admin.access.tenant_mapping.upsert',
          actorUserRandId,
          targetType: 'tenant_whitelist',
          targetRandId: item.tenantName,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/access/users/assign-org',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!requireAuthAdminApi(req, res)) return;
        const actorUserRandId = req.sessionContext!.user.randId;
        const item = await assignUserOrganization({
          userRandId: optionalString(req.body.user_rand_id || req.body.userRandId, 64),
          orgRandId: optionalString(req.body.org_rand_id || req.body.orgRandId, 64),
          isAssignmentActive:
            typeof req.body.is_assignment_active === 'boolean'
              ? req.body.is_assignment_active
              : typeof req.body.isAssignmentActive === 'boolean'
                ? req.body.isAssignmentActive
                : undefined,
          actorUserRandId,
        });

        await logActivity({
          eventType: 'admin.access.user_org.upsert',
          actorUserRandId,
          targetType: 'user_orgs',
          targetRandId: item.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    '/api/admin/access/users/assign-role',
    requireTrustedOrigin,
    requireSession,
    requireCsrf,
    async (req, res, next) => {
      try {
        if (!requireAuthAdminApi(req, res)) return;
        const actorUserRandId = req.sessionContext!.user.randId;
        const item = await assignUserRole({
          userRandId: optionalString(req.body.user_rand_id || req.body.userRandId, 64),
          roleRandId: optionalString(req.body.role_rand_id || req.body.roleRandId, 64),
          orgRandId: optionalString(req.body.org_rand_id || req.body.orgRandId, 64),
          isAssignmentActive:
            typeof req.body.is_assignment_active === 'boolean'
              ? req.body.is_assignment_active
              : typeof req.body.isAssignmentActive === 'boolean'
                ? req.body.isAssignmentActive
                : undefined,
          actorUserRandId,
        });

        await logActivity({
          eventType: 'admin.access.user_role.upsert',
          actorUserRandId,
          targetType: 'user_roles',
          targetRandId: item.randId,
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
        });

        res.status(200).json({ item });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get('/profile', (req, res, next) => {
    if (!req.sessionContext) {
      setLoginUiState(res, { mode: 'signin', error: 'Please sign in first' });
      res.redirect('/login');
      return;
    }
    next();
  });

  app.get('/account', (req, res, next) => {
    if (!req.sessionContext) {
      setLoginUiState(res, { mode: 'signin', error: 'Please sign in first' });
      res.redirect('/login');
      return;
    }
    next();
  });

  app.get('/auth/admin', (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(`/admin${query}`);
  });

  app.get('/auth/admin/tenants', (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(`/admin/tenants${query}`);
  });

  app.get('/auth/admin/access', (req, res) => {
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(`/admin/access${query}`);
  });

  app.get('/admin', (req, res, next) => {
    if (!req.sessionContext || !isAuthAdmin(req)) {
      setLoginUiState(res, { mode: 'signin', error: 'Auth admin access required' });
      res.redirect('/login');
      return;
    }
    next();
  });

  app.get('/admin/tenants', (req, res, next) => {
    if (!req.sessionContext || !isAuthAdmin(req)) {
      setLoginUiState(res, { mode: 'signin', error: 'Auth admin access required' });
      res.redirect('/login');
      return;
    }
    next();
  });

  app.get('/admin/access', (req, res, next) => {
    if (!req.sessionContext || !isAuthAdmin(req)) {
      setLoginUiState(res, { mode: 'signin', error: 'Auth admin access required' });
      res.redirect('/login');
      return;
    }
    next();
  });

  app.all('*', (req, res) => nextHandler(req, res));

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error('[auth-service] request error', error);
    const statusCode = (error as { statusCode?: number }).statusCode || 500;
    res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`[auth-service] listening on ${config.host}:${config.port} (${config.baseUrl})`);
  });

  const shutdown = async (): Promise<void> => {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

boot().catch((error) => {
  console.error('[auth-service] boot failure', error);
  process.exit(1);
});
