import express, { Response } from 'express';
import { isAuthAdmin } from './guards';

type SetLoginUiState = (res: Response, state: { mode?: 'signin' | 'signup'; error?: string }) => void;

const appendQuery = (url: string, query: string): string => {
  if (!query) return url;
  return `${url}${query}`;
};

const queryFromOriginalUrl = (originalUrl: string): string => {
  return originalUrl.includes('?') ? originalUrl.slice(originalUrl.indexOf('?')) : '';
};

const requireAdminPageAccess = (setLoginUiState: SetLoginUiState) =>
  (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (!req.sessionContext || !isAuthAdmin(req)) {
      setLoginUiState(res, { mode: 'signin', error: 'Auth admin access required' });
      res.redirect('/login');
      return;
    }
    next();
  };

export const registerAdminPageRoutes = (
  app: express.Express,
  opts: { setLoginUiState: SetLoginUiState },
): void => {
  app.get('/auth/admin', (req, res) => {
    const query = queryFromOriginalUrl(req.originalUrl);
    res.redirect(appendQuery('/admin', query));
  });

  app.get('/auth/admin/tenants', (req, res) => {
    const query = queryFromOriginalUrl(req.originalUrl);
    res.redirect(appendQuery('/admin/tenants', query));
  });

  app.get('/auth/admin/access', (req, res) => {
    const query = queryFromOriginalUrl(req.originalUrl);
    res.redirect(appendQuery('/admin/access', query));
  });

  const adminGuard = requireAdminPageAccess(opts.setLoginUiState);
  app.get('/admin', adminGuard);
  app.get('/admin/tenants', adminGuard);
  app.get('/admin/access', adminGuard);
};
