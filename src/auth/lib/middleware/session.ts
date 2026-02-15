import { NextFunction, Request, Response } from 'express';
import {
  clearSessionCookie,
  readSessionFromToken,
  readSignedSessionCookie,
  touchSession,
} from '../sessions';

export const attachSessionContext = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = readSignedSessionCookie(req);
    if (!token) {
      req.sessionContext = null;
      next();
      return;
    }

    const context = await readSessionFromToken(token);
    if (!context) {
      req.sessionContext = null;
      clearSessionCookie(req, res);
      next();
      return;
    }

    req.sessionContext = context;
    await touchSession(context.session.randId);
    next();
  } catch (error) {
    next(error);
  }
};

export const requireSession = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.sessionContext) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
};

export const requireCsrf = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.sessionContext) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const headerToken = String(req.headers['x-csrf-token'] || '').trim();
  if (!headerToken || headerToken !== req.sessionContext.session.csrfToken) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }

  next();
};
