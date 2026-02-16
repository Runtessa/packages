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
} from './lib/services/tenant-whitelist';

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

const encodeErrorParam = (error: unknown): string => encodeURIComponent(toErrorMessage(error, 'Unexpected error'));

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

const appendAuthContext = (
  baseUrl: string,
  {
    returnTo,
    clientId,
    tenantName,
  }: {
    returnTo: string;
    clientId?: string;
    tenantName?: string;
  },
): string => {
  let location = `${baseUrl}?returnTo=${encodeURIComponent(returnTo)}`;
  if (clientId) location = appendQuery(location, 'client_id', clientId);
  if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
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

  app.post('/api/profile/details', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      await updateProfileDetails(
        userRandId,
        {
          firstName: optionalString(req.body.firstName ?? req.body.first_name, 120) || undefined,
          lastName: optionalString(req.body.lastName ?? req.body.last_name, 120) || undefined,
          nationalId: optionalString(req.body.nationalId ?? req.body.national_id, 96) || undefined,
          phoneNumber: optionalString(req.body.phoneNumber ?? req.body.phone_number, 32) || undefined,
          avatarUrl: req.body.avatarUrl ?? req.body.avatar_url ?? undefined,
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
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
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
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
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
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
    }
  });

  app.post('/auth/login/otp/complete', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
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
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
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
      res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
    }
  });

  const completeTwoFactorLogin = async (req: Request, res: Response): Promise<void> => {
    const requestReturnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const requestClientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const requestTenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
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

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: effectiveUser.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      clearLoginTwoFactorPending(res);
      issueSessionCookie(req, res, sessionToken, resolveTenantHostForCookie(req, returnTo));

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
      res.redirect(appendAuthContext('/login', { returnTo: requestReturnTo, clientId: requestClientId, tenantName: requestTenantName }));
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
            return appendAuthContext('/login', { returnTo, clientId, tenantName });
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
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
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
          return appendAuthContext('/login', { returnTo, clientId, tenantName });
        })(),
      );
    }
  });

  app.post('/auth/register/start', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const requestedSignupStep = optionalString(req.body.signup_step || req.query.signup_step, 16).toLowerCase();

    try {
      const normalizedPhone = await assertPhoneRegistrationAllowed({
        phoneNumber,
        clientId: clientId || undefined,
        tenantName: tenantName || undefined,
      });

      const challenge = await issueOtpChallenge({
        purpose: 'signup',
        destinationPhone: normalizedPhone,
        payload: {
          clientId: clientId || null,
          tenantName: tenantName || null,
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
          tenantName: tenantName || null,
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
          return appendAuthContext('/login', { returnTo, clientId, tenantName });
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
          return appendAuthContext('/login', { returnTo, clientId, tenantName });
        })(),
      );
    }
  });

  app.post('/auth/register/complete', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const phoneNumber = optionalString(req.body.phone_number || req.body.phoneNumber || req.query.phone_number, 32);
    const otpCode = optionalString(req.body.otp_code || req.body.otpCode || req.query.otp_code, 12);

    try {
      await verifyOtpChallenge({
        purpose: 'signup',
        destinationPhone: phoneNumber,
        code: otpCode,
      });

      const user = await registerUserByPhone({
        phoneNumber,
        clientId: clientId || undefined,
        tenantName: tenantName || undefined,
      });

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
          return appendAuthContext('/login', { returnTo, clientId, tenantName });
        })(),
      );
    }
  });

  app.post('/auth/register', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
    const authUi = optionalString(req.body.auth_ui, 32).toLowerCase();

    try {
      const user = await registerUser({
        email: String(req.body.email || ''),
        password: String(req.body.password || ''),
        firstName: String(req.body.first_name || req.body.firstName || ''),
        lastName: String(req.body.last_name || req.body.lastName || ''),
        nationalId: String(req.body.national_id || req.body.nationalId || ''),
        phoneNumber: String(req.body.phone_number || req.body.phoneNumber || ''),
        clientId: clientId || undefined,
        tenantName: tenantName || undefined,
      });

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
        res.redirect(appendAuthContext('/login', { returnTo, clientId, tenantName }));
        return;
      }

      let location = `/register?error=${encodeErrorParam(error)}&returnTo=${encodeURIComponent(returnTo)}`;
      if (clientId) location = appendQuery(location, 'client_id', clientId);
      if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
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
    try {
      const responseType = optionalString(req.query.response_type, 16);
      const clientId = assertCode(req.query.client_id, 'client_id');
      const redirectUri = optionalString(req.query.redirect_uri, 2048);
      const scopeRaw = optionalString(req.query.scope, 2000);
      const state = optionalString(req.query.state, 4096);
      const codeChallenge = optionalString(req.query.code_challenge, 256);
      const codeChallengeMethod = optionalString(req.query.code_challenge_method, 16);

      if (responseType !== 'code') {
        res.status(400).json({ error: 'Only authorization code flow is supported' });
        return;
      }

      const client = await readClientById(clientId);
      if (!client || !client.isActive) {
        res.status(400).json({ error: 'Unknown client_id' });
        return;
      }

      const redirectContext = await validateAuthorizeRedirect(client, redirectUri);
      const scope = assertScopeAllowed(client, scopeRaw);

      if (client.requirePkce && !codeChallenge) {
        res.status(400).json({ error: 'PKCE is required for this client' });
        return;
      }

      if (!req.sessionContext) {
        const returnTo = safeReturnTo(req.originalUrl, '/login');
        const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}&client_id=${encodeURIComponent(
          clientId,
        )}&tenant_name=${encodeURIComponent(redirectContext.tenantName)}`;
        res.redirect(loginUrl);
        return;
      }

      const code = await createAuthorizationCode({
        clientId,
        tenantRandId: client.tenantRandId,
        tenantName: redirectContext.tenantName,
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
      res.status((error as { statusCode?: number }).statusCode || 400).json({
        error: error instanceof Error ? error.message : 'authorize_failed',
      });
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
      const tenantNameFromRedirect = redirectUri ? extractTenantNameFromRedirectUri(redirectUri) : '';
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

      const token = await createAccessToken({
        clientId,
        tenantRandId: authorizationCode.tenantRandId,
        tenantName: authorizationCode.tenantName,
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

      res.status(200).json(token);
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

    res.status(200).json({
      sub: context.user?.randId || null,
      email: context.user?.email || null,
      given_name: context.user?.firstName || null,
      family_name: context.user?.lastName || null,
      tenant_rand_id: context.token.tenantRandId,
      tenant_name: context.token.tenantName,
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
