import express from 'express';
import { requireCsrf, requireSession } from '../../lib/middleware/session';
import { requireTrustedOrigin } from '../../lib/security';
import { requestIp, requestUserAgent } from '../../lib/http';
import {
  createTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactorWithCode,
  getUserProfileSnapshot,
} from '../../lib/services/profile';
import { logActivity } from '../../lib/activity';

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

export const registerProfileTwoFactorRoutes = (app: express.Express): void => {
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

      const verificationCode = optionalString(req.body.verificationCode ?? req.body.verification_code ?? req.body.code, 16);
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
};
