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
import { authenticateUser, registerUser } from './lib/services/auth';
import { bootstrapAuthDefaults } from './lib/services/bootstrap';
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

  app.post('/auth/login', loginLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || req.query.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);

    try {
      const user = await authenticateUser({
        email: String(req.body.email || ''),
        password: String(req.body.password || ''),
      });

      if (!user) {
        await logActivity({
          eventType: 'auth.login.failed',
          ipAddress: requestIp(req),
          userAgent: requestUserAgent(req),
          payload: { email: String(req.body.email || '').toLowerCase() },
        });

        if (wantsJson(req)) {
          res.status(401).json({ error: 'Invalid credentials' });
          return;
        }

        let location = `/login?error=${encodeErrorParam('Invalid credentials')}&returnTo=${encodeURIComponent(
          returnTo,
        )}`;
        if (clientId) location = appendQuery(location, 'client_id', clientId);
        if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
        res.redirect(location);
        return;
      }

      const { sessionToken, sessionEntity } = await createSession({
        userRandId: user.randId,
        tenantRandId: null,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

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

      let location = `/login?error=${encodeErrorParam(error)}&returnTo=${encodeURIComponent(returnTo)}`;
      if (clientId) location = appendQuery(location, 'client_id', clientId);
      if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
      res.redirect(location);
    }
  });

  app.post('/auth/register', registerLimiter, requireTrustedOrigin, async (req, res) => {
    const returnTo = safeReturnTo(req.body.returnTo || '/profile', '/profile');
    const clientId = optionalString(req.body.client_id || req.query.client_id, 120);
    const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);

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
      res.redirect('/login?error=' + encodeURIComponent('Please sign in first'));
      return;
    }
    next();
  });

  app.get('/account', (req, res, next) => {
    if (!req.sessionContext) {
      res.redirect('/login?error=' + encodeURIComponent('Please sign in first'));
      return;
    }
    next();
  });

  app.get('/admin/tenants', (req, res, next) => {
    if (!req.sessionContext || !isAuthAdmin(req)) {
      res.redirect('/login?error=' + encodeURIComponent('Auth admin access required'));
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

  const server = app.listen(config.port, () => {
    console.log(`[auth-service] listening on ${config.baseUrl}`);
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
