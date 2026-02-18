import { Request, Response } from 'express';

export const isAuthAdmin = (req: Request): boolean => {
  const meta = (req.sessionContext?.user?.meta || {}) as Record<string, unknown>;
  return meta.authAdmin === true;
};

export const requireAuthAdminApi = (req: Request, res: Response): boolean => {
  if (!req.sessionContext || !isAuthAdmin(req)) {
    res.status(403).json({ error: 'Admin access required' });
    return false;
  }
  return true;
};
