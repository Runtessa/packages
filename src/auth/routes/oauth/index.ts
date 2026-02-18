import express, { Response } from 'express';
import { registerOAuthAuthorizeRoute } from './authorize';
import { registerOAuthTokenRoute } from './token';
import { registerOAuthUserinfoRoute } from './userinfo';
import { registerOAuthTenantSyncRoute } from './tenant-sync';

export const registerOAuthRoutes = (
  app: express.Express,
  opts: { setLoginUiState: (res: Response, state: { mode?: 'signin' | 'signup'; error?: string }) => void },
): void => {
  registerOAuthAuthorizeRoute(app, opts);
  registerOAuthTokenRoute(app);
  registerOAuthUserinfoRoute(app);
  registerOAuthTenantSyncRoute(app);
};
