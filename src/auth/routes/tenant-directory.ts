import express, { Request } from 'express';
import { oauthLimiter, parseBearer } from '../lib/security';
import { verifyTenantSsoToken } from '../lib/services/tenant-whitelist';
import { getTenantOrgDirectory, getTenantOu, getTenantUsersByOu } from '../lib/services/tenant-directory';

const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

const readTenantServiceToken = (req: Request): string => {
  const fromHeader = optionalString(req.headers['x-tenant-sso-token'], 512);
  if (fromHeader) return fromHeader;
  const fromBody = optionalString(req.body?.tenant_sso_token || req.body?.tenantSsoToken, 512);
  if (fromBody) return fromBody;
  const fromQuery = optionalString(req.query?.tenant_sso_token || req.query?.tenantSsoToken, 512);
  if (fromQuery) return fromQuery;
  return parseBearer(req.headers.authorization);
};

export const registerTenantDirectoryRoutes = (app: express.Express): void => {
  app.get('/api/tenant-directory/org', oauthLimiter, async (req, res, next) => {
    try {
      const tenantName = optionalString(req.query.tenant_name || req.headers['x-tenant-name'], 255);
      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required' });
        return;
      }

      const tenantSsoToken = readTenantServiceToken(req);
      if (!tenantSsoToken) {
        res.status(401).json({ error: 'tenant_sso_token is required' });
        return;
      }

      const tenantEntry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
      if (!tenantEntry) {
        res.status(401).json({ error: 'Invalid tenant token' });
        return;
      }

      const payload = await getTenantOrgDirectory(tenantEntry.tenantName);
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/tenant-directory/ou', oauthLimiter, async (req, res, next) => {
    try {
      const tenantName = optionalString(req.query.tenant_name || req.headers['x-tenant-name'], 255);
      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required' });
        return;
      }

      const tenantSsoToken = readTenantServiceToken(req);
      if (!tenantSsoToken) {
        res.status(401).json({ error: 'tenant_sso_token is required' });
        return;
      }

      const tenantEntry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
      if (!tenantEntry) {
        res.status(401).json({ error: 'Invalid tenant token' });
        return;
      }

      const ouPath = optionalString(req.query.ou_path || req.query.ouPath, 512);
      const payload = await getTenantOu(tenantEntry.tenantName, ouPath);
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/tenant-directory/users', oauthLimiter, async (req, res, next) => {
    try {
      const tenantName = optionalString(req.query.tenant_name || req.headers['x-tenant-name'], 255);
      if (!tenantName) {
        res.status(400).json({ error: 'tenant_name is required' });
        return;
      }

      const tenantSsoToken = readTenantServiceToken(req);
      if (!tenantSsoToken) {
        res.status(401).json({ error: 'tenant_sso_token is required' });
        return;
      }

      const tenantEntry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
      if (!tenantEntry) {
        res.status(401).json({ error: 'Invalid tenant token' });
        return;
      }

      const ouPath = optionalString(req.query.ou_path || req.query.ouPath, 512);
      const payload = await getTenantUsersByOu(tenantEntry.tenantName, ouPath);
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });
};
