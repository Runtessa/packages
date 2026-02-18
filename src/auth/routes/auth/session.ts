import express from 'express';
import { requireCsrf, requireSession } from '../../lib/middleware/session';
import { requireTrustedOrigin } from '../../lib/security';
import { clearSessionCookie, issueSessionCookie, renewSession, revokeSession } from '../../lib/sessions';
import { requestIp, requestUserAgent } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import { resolveTenantHostForCookie } from '../helpers';

export const registerAuthSessionRoutes = (app: express.Express, opts: { sessionCookieName: string }): void => {
  const renewSessionHandler = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    try {
      if (!req.sessionContext) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      await renewSession(req.sessionContext.session.randId);
      const signedToken = req.signedCookies?.[opts.sessionCookieName];
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
};
