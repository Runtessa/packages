import 'dotenv/config';
import 'reflect-metadata';
import next from 'next';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { config } from './lib/config';
import { ensureDatabaseReady, closeDatabase } from './lib/db';
import { applyCorsForApi, defaultHelmet, parseBearer } from './lib/security';
import { attachSessionContext } from './lib/middleware/session';
import { bootstrapAuthDefaults } from './lib/services/bootstrap';
import { safeEqual } from './lib/crypto';
import { registerTenantDirectoryRoutes } from './routes/tenant-directory';
import { registerAdminRoutes, isAuthAdmin } from './routes/admin';
import { registerPublicRoutes } from './routes/public';
import { registerSessionRoutes } from './routes/session';
import { registerProfileRoutes } from './routes/profile';
import { registerAuthRoutes } from './routes/auth';
import { registerOAuthRoutes } from './routes/oauth';
import { clearLoginUiState, LOGIN_UI_STATE_COOKIE, setLoginUiState } from './routes/login-ui-state';

const dev = config.nodeEnv !== 'production';
const nextApp = next({ dev, dir: __dirname });
const nextHandler = nextApp.getRequestHandler();

const requireInternalApiToken = (
  req: Request,
  res: Response,
  nextMiddleware: express.NextFunction,
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

  nextMiddleware();
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

  registerPublicRoutes(app, {
    requireInternalApiToken,
    clearLoginUiState,
    loginUiStateCookieName: LOGIN_UI_STATE_COOKIE,
  });
  registerTenantDirectoryRoutes(app);
  registerSessionRoutes(app, { isAuthAdmin });
  registerProfileRoutes(app);
  registerAuthRoutes(app, { sessionCookieName: config.cookie.name });
  registerOAuthRoutes(app, { setLoginUiState });
  registerAdminRoutes(app, { setLoginUiState });

  app.get('/profile', (req, res, nextMiddleware) => {
    if (!req.sessionContext) {
      setLoginUiState(res, { mode: 'signin', error: 'Please sign in first' });
      res.redirect('/login');
      return;
    }
    nextMiddleware();
  });

  app.get('/account', (req, res, nextMiddleware) => {
    if (!req.sessionContext) {
      setLoginUiState(res, { mode: 'signin', error: 'Please sign in first' });
      res.redirect('/login');
      return;
    }
    nextMiddleware();
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
