import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { Tenant } from '@/lib/entities/Tenant';

const DEFAULT_RESOURCE_CONFIG = { memory: 512, timeout: 5000 };

const getTenantId = (req: NextApiRequest) => {
  const raw = req.query.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) {
    const err = new Error('tenant id is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return id;
};

const normalizeHostname = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('hostname is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const normalizeNumber = (raw: unknown, label: string, fallback: number) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error(`${label} must be a positive number`);
    (err as any).statusCode = 400;
    throw err;
  }
  return value;
};

const normalizeResourceConfig = (
  raw: unknown,
  fallback: { memory: number; timeout: number }
) => {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'object') {
    const err = new Error('resourceConfig must be an object');
    (err as any).statusCode = 400;
    throw err;
  }
  const values = raw as { memory?: unknown; timeout?: unknown };
  return {
    memory: normalizeNumber(values.memory, 'resourceConfig.memory', fallback.memory),
    timeout: normalizeNumber(values.timeout, 'resourceConfig.timeout', fallback.timeout),
  };
};

const normalizeRestrictRoutes = (raw: unknown, fallback: string[] = []) => {
  if (raw === undefined || raw === null) return fallback;
  let items: string[] = [];
  if (Array.isArray(raw)) {
    items = raw.map((item) => String(item));
  } else if (typeof raw === 'string') {
    items = raw.split(/[\n,]+/g).map((item) => item.trim());
  } else {
    const err = new Error('restrictRoutes must be an array of strings');
    (err as any).statusCode = 400;
    throw err;
  }
  return items
    .map((route) => route.trim())
    .filter(Boolean)
    .map((route) => (route.startsWith('/') ? route : `/${route}`));
};

const normalizeBoolean = (raw: unknown, fallback: boolean) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  const err = new Error('isSuspended must be a boolean');
  (err as any).statusCode = 400;
  throw err;
};

const serializeTenant = (tenant: Tenant) => ({
  id: tenant.id,
  hostname: tenant.hostname,
  isSuspended: tenant.isSuspended,
  resourceConfig: tenant.resourceConfig,
  restrictRoutes: tenant.restrictRoutes ?? [],
  createdAt: tenant.createdAt,
  updatedAt: tenant.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireAdmin(req);
  await ensureCoreSchema();

  const tenantId = getTenantId(req);
  const repo = CoreDataSource.getRepository(Tenant);

  if (req.method === 'GET') {
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    res.status(200).json({ tenant: serializeTenant(tenant) });
    return;
  }

  if (req.method === 'PUT') {
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const nextHostname =
      req.body?.hostname !== undefined ? normalizeHostname(req.body.hostname) : tenant.hostname;
    const nextSuspended = normalizeBoolean(req.body?.isSuspended, tenant.isSuspended);
    const nextResourceConfig = normalizeResourceConfig(
      req.body?.resourceConfig,
      tenant.resourceConfig ?? DEFAULT_RESOURCE_CONFIG
    );
    const nextRestrictRoutes = normalizeRestrictRoutes(
      req.body?.restrictRoutes,
      tenant.restrictRoutes ?? []
    );

    if (nextHostname !== tenant.hostname) {
      const duplicate = await repo.findOne({ where: { hostname: nextHostname } });
      if (duplicate && duplicate.id !== tenant.id) {
        res.status(409).json({ error: 'Tenant with this hostname already exists' });
        return;
      }
    }

    tenant.hostname = nextHostname;
    tenant.isSuspended = nextSuspended;
    tenant.resourceConfig = nextResourceConfig;
    tenant.restrictRoutes = nextRestrictRoutes;
    await repo.save(tenant);

    res.status(200).json({ tenant: serializeTenant(tenant) });
    return;
  }

  if (req.method === 'DELETE') {
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    await repo.remove(tenant);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
