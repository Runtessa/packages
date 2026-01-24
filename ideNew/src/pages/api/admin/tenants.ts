import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { Tenant, TenantStage } from '@/lib/entities/Tenant';

const DEFAULT_RESOURCE_CONFIG = { memory: 512, timeout: 5000 };

const normalizeHostname = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('hostname is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const normalizeStage = (raw: unknown, fallback: TenantStage = TenantStage.DEV): TenantStage => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string') {
    const err = new Error('stage must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  const upper = raw.toUpperCase();
  if (!Object.values(TenantStage).includes(upper as TenantStage)) {
    const err = new Error('stage must be DEV, STAGING, or PROD');
    (err as any).statusCode = 400;
    throw err;
  }
  return upper as TenantStage;
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
  stage: tenant.stage,
  isSuspended: tenant.isSuspended,
  resourceConfig: tenant.resourceConfig,
  restrictRoutes: tenant.restrictRoutes ?? [],
  createdAt: tenant.createdAt,
  updatedAt: tenant.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(Tenant);
    const tenants = await repo.find({ order: { hostname: 'ASC' } });

    res.status(200).json({
      tenants: tenants.map(serializeTenant),
    });
    return;
  }

  if (req.method === 'POST') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const hostname = normalizeHostname(req.body?.hostname);
    const stage = normalizeStage(req.body?.stage, TenantStage.DEV);
    const isSuspended = normalizeBoolean(req.body?.isSuspended, false);
    const resourceConfig = normalizeResourceConfig(req.body?.resourceConfig, DEFAULT_RESOURCE_CONFIG);
    const restrictRoutes = normalizeRestrictRoutes(req.body?.restrictRoutes, []);

    const repo = CoreDataSource.getRepository(Tenant);
    const existing = await repo.findOne({ where: { hostname } });
    if (existing) {
      res.status(409).json({ error: 'Tenant with this hostname already exists' });
      return;
    }

    const tenant = repo.create({
      hostname,
      stage,
      isSuspended,
      resourceConfig,
      restrictRoutes,
    });
    await repo.save(tenant);

    res.status(201).json({ tenant: serializeTenant(tenant) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
