import express from 'express';
import { requireCsrf, requireSession } from '../../lib/middleware/session';
import { requireTrustedOrigin } from '../../lib/security';
import { requestIp, requestUserAgent } from '../../lib/http';
import { logActivity } from '../../lib/activity';
import {
  assignTenantOrganization,
  assignUserOrganization,
  assignUserRole,
  upsertOrganization,
  upsertRole,
} from '../../lib/services/access-admin';
import { requireAuthAdminApi } from './guards';

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

export const registerAdminAccessWriteRoutes = (app: express.Express): void => {
  app.post('/api/admin/access/organizations', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const actorUserRandId = req.sessionContext!.user.randId;
      const item = await upsertOrganization({
        randId: optionalString(req.body.rand_id || req.body.randId, 64) || undefined,
        name: optionalString(req.body.name, 180),
        code: optionalString(req.body.code, 96),
        parentOrgRandId: optionalString(req.body.parent_org_rand_id || req.body.parentOrgRandId, 64) || null,
        isActive:
          typeof req.body.is_active === 'boolean'
            ? req.body.is_active
            : typeof req.body.isActive === 'boolean'
              ? req.body.isActive
              : undefined,
        actorUserRandId,
      });

      await logActivity({
        eventType: 'admin.access.org.upsert',
        actorUserRandId,
        targetType: 'organization',
        targetRandId: item.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/access/roles', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const actorUserRandId = req.sessionContext!.user.randId;
      const item = await upsertRole({
        randId: optionalString(req.body.rand_id || req.body.randId, 64) || undefined,
        roleName: optionalString(req.body.role_name || req.body.roleName, 160),
        roleCode: optionalString(req.body.role_code || req.body.roleCode, 96),
        orgRandId: optionalString(req.body.org_rand_id || req.body.orgRandId, 64),
        isActive:
          typeof req.body.is_active === 'boolean'
            ? req.body.is_active
            : typeof req.body.isActive === 'boolean'
              ? req.body.isActive
              : undefined,
        actorUserRandId,
      });

      await logActivity({
        eventType: 'admin.access.role.upsert',
        actorUserRandId,
        targetType: 'role',
        targetRandId: item.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/access/tenant-mappings', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const actorUserRandId = req.sessionContext!.user.randId;
      const item = await assignTenantOrganization({
        tenantName: optionalString(req.body.tenant_name || req.body.tenantName, 255),
        organizationRandId: optionalString(req.body.organization_rand_id || req.body.organizationRandId, 64) || null,
      });

      await logActivity({
        eventType: 'admin.access.tenant_mapping.upsert',
        actorUserRandId,
        targetType: 'tenant_whitelist',
        targetRandId: item.tenantName,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/access/users/assign-org', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const actorUserRandId = req.sessionContext!.user.randId;
      const item = await assignUserOrganization({
        userRandId: optionalString(req.body.user_rand_id || req.body.userRandId, 64),
        orgRandId: optionalString(req.body.org_rand_id || req.body.orgRandId, 64),
        isAssignmentActive:
          typeof req.body.is_assignment_active === 'boolean'
            ? req.body.is_assignment_active
            : typeof req.body.isAssignmentActive === 'boolean'
              ? req.body.isAssignmentActive
              : undefined,
        actorUserRandId,
      });

      await logActivity({
        eventType: 'admin.access.user_org.upsert',
        actorUserRandId,
        targetType: 'user_orgs',
        targetRandId: item.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ item });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/access/users/assign-role', requireTrustedOrigin, requireSession, requireCsrf, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const actorUserRandId = req.sessionContext!.user.randId;
      const item = await assignUserRole({
        userRandId: optionalString(req.body.user_rand_id || req.body.userRandId, 64),
        roleRandId: optionalString(req.body.role_rand_id || req.body.roleRandId, 64),
        orgRandId: optionalString(req.body.org_rand_id || req.body.orgRandId, 64),
        isAssignmentActive:
          typeof req.body.is_assignment_active === 'boolean'
            ? req.body.is_assignment_active
            : typeof req.body.isAssignmentActive === 'boolean'
              ? req.body.isAssignmentActive
              : undefined,
        actorUserRandId,
      });

      await logActivity({
        eventType: 'admin.access.user_role.upsert',
        actorUserRandId,
        targetType: 'user_roles',
        targetRandId: item.randId,
        ipAddress: requestIp(req),
        userAgent: requestUserAgent(req),
      });

      res.status(200).json({ item });
    } catch (error) {
      next(error);
    }
  });
};
