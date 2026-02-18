import express from 'express';
import { requireCsrf, requireSession } from '../../lib/middleware/session';
import { requireTrustedOrigin } from '../../lib/security';
import { requestIp, requestUserAgent } from '../../lib/http';
import {
  getUserProfileSnapshot,
  updateProfileDetails,
  updateProfilePassword,
} from '../../lib/services/profile';
import { logActivity } from '../../lib/activity';
import {
  removeManagedAvatarFromDisk,
  saveAvatarDataUrlToDisk,
  saveAvatarToDisk,
} from '../../lib/services/avatar-storage';

const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

const readRequestBuffer = async (req: express.Request, maxBytes: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Avatar file is too large. Maximum size is 2 MB.') as Error & { statusCode: number };
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

export const registerProfileAccountRoutes = (app: express.Express): void => {
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

  app.post('/api/profile/avatar/upload', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      const userRandId = req.sessionContext?.user.randId;
      if (!userRandId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const contentType = String(req.headers['content-type'] || '').split(';')[0]?.trim().toLowerCase();
      if (!contentType) {
        res.status(400).json({ error: 'Avatar content type is required' });
        return;
      }

      const avatar = await readRequestBuffer(req, AVATAR_UPLOAD_MAX_BYTES);
      const avatarUrl = await saveAvatarToDisk(userRandId, avatar, contentType);
      res.status(200).json({ ok: true, avatarUrl });
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

      const firstName = optionalString(req.body.firstName ?? req.body.first_name, 120);
      const lastName = optionalString(req.body.lastName ?? req.body.last_name, 120);
      const nationalId = optionalString(req.body.nationalId ?? req.body.national_id, 96);
      const phoneNumber = optionalString(req.body.phoneNumber ?? req.body.phone_number, 32);

      if (!firstName || !lastName || !nationalId) {
        res.status(400).json({ error: 'firstName, lastName, and nationalId are required' });
        return;
      }
      if (!phoneNumber) {
        res.status(400).json({ error: 'phoneNumber is required' });
        return;
      }

      const previousAvatar = (await getUserProfileSnapshot(userRandId)).user.avatarUrl;
      const avatarRaw = req.body.avatarUrl ?? req.body.avatar_url ?? undefined;
      let normalizedAvatar: string | null | undefined = avatarRaw;
      if (typeof avatarRaw === 'string' && avatarRaw.trim().toLowerCase().startsWith('data:image/')) {
        normalizedAvatar = await saveAvatarDataUrlToDisk(userRandId, avatarRaw, AVATAR_UPLOAD_MAX_BYTES);
      }

      await updateProfileDetails(
        userRandId,
        {
          firstName,
          lastName,
          nationalId,
          phoneNumber,
          avatarUrl: normalizedAvatar,
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
      if (previousAvatar && previousAvatar !== profile.user.avatarUrl) {
        try {
          await removeManagedAvatarFromDisk(previousAvatar);
        } catch (avatarError) {
          console.warn('[auth] failed to remove old avatar file', avatarError);
        }
      }
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
};
