import express from 'express';
import { requireSession } from '../../lib/middleware/session';
import {
  listOrganizations,
  listRoles,
  listTenantOrganizationMappings,
  listUsersWithAssignments,
} from '../../lib/services/access-admin';
import { requireAuthAdminApi } from './guards';

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

export const registerAdminAccessReadRoutes = (app: express.Express): void => {
  app.get('/api/admin/access/organizations', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const items = await listOrganizations();
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/access/roles', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const items = await listRoles();
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/access/tenant-mappings', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const items = await listTenantOrganizationMappings();
      res.status(200).json({ items });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/access/users', requireSession, async (req, res, next) => {
    try {
      if (!requireAuthAdminApi(req, res)) return;
      const page = Number(req.query.page);
      const limit = Number(req.query.limit);
      const search = optionalString(req.query.search, 200) || undefined;
      const tenantName = optionalString(req.query.tenant_name || req.query.tenantName, 255) || undefined;
      const tenantOrgRandId = optionalString(req.query.tenant_org_rand_id || req.query.tenantOrgRandId, 64) || undefined;
      const result = await listUsersWithAssignments({
        page: Number.isFinite(page) ? page : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        search,
        tenantName,
        tenantOrgRandId,
      });
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });
};
