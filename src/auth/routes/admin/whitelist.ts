import express from 'express';
import { requireCsrf, requireSession } from '../../lib/middleware/session';
import { requireTrustedOrigin } from '../../lib/security';
import { requestIp, requestUserAgent } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import {
  createOrUpdateWhitelistTenant,
  deleteWhitelistTenant,
  listWhitelist,
  normalizeTenantName,
  rotateWhitelistTenantToken,
} from '../../lib/services/tenant-whitelist';
import { isAuthAdmin } from './guards';

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

export const registerAdminWhitelistRoutes = (app: express.Express): void => {
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

  app.post('/api/admin/tenant-whitelist', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
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
  });

  app.post('/api/admin/tenant-whitelist/:tenantName/rotate-token', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
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
  });

  app.delete('/api/admin/tenant-whitelist/:tenantName', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
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
  });
};
