import express, { Response } from 'express';
import { registerAdminWhitelistRoutes } from './whitelist';
import { registerAdminAccessReadRoutes } from './access-read';
import { registerAdminAccessWriteRoutes } from './access-write';
import { registerAdminPageRoutes } from './pages';

export const registerAdminRoutes = (
  app: express.Express,
  opts: { setLoginUiState: (res: Response, state: { mode?: 'signin' | 'signup'; error?: string }) => void },
): void => {
  registerAdminWhitelistRoutes(app);
  registerAdminAccessReadRoutes(app);
  registerAdminAccessWriteRoutes(app);
  registerAdminPageRoutes(app, opts);
};

export { isAuthAdmin } from './guards';
