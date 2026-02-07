import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { Tenant } from '@idp/shared';
import { Secret } from '@idp/shared';
import { encryptSecret } from '@/lib/crypto';
import { maskPasswordFields, resolveMaskedPasswords } from '@/lib/adapter-config-passwords';
import { parseAdapterConfig } from '@/lib/tenant-adapter-config';

const DEFAULT_RESOURCE_CONFIG = { memory: 512, timeout: 5000 };

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

const normalizeBoolean = (raw: unknown, fallback: boolean) => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  const err = new Error('isSuspended must be a boolean');
  (err as any).statusCode = 400;
  throw err;
};

const parseAdapterConfigObject = (raw: unknown): Record<string, unknown> | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        const err = new Error('adapterConfig must be an object');
        (err as any).statusCode = 400;
        throw err;
      }
      return parsed as Record<string, unknown>;
    } catch {
      const err = new Error('adapterConfig must be valid JSON');
      (err as any).statusCode = 400;
      throw err;
    }
  }
  if (typeof raw !== 'object') {
    const err = new Error('adapterConfig must be an object');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw as Record<string, unknown>;
};

const serializeTenant = (tenant: Tenant) => ({
  id: tenant.id,
  hostname: tenant.hostname,
  isSuspended: tenant.isSuspended,
  allowRegistration: tenant.allowRegistration ?? true,
  resourceConfig: tenant.resourceConfig,
  adapterAccess: tenant.adapterAccess ?? {},
  adapterConfig: tenant.adapterConfig ?? {},
  createdAt: tenant.createdAt,
  updatedAt: tenant.updatedAt,
});

const parsePagination = (rawPage: unknown, rawLimit: unknown) => {
  const pageValue = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
  const pageNum = Number(pageValue ?? 1);
  const limitNum = Number(limitValue ?? 20);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(100, Math.floor(limitNum)) : 20;
  return { page, limit, skip: (page - 1) * limit };
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(Tenant);
    const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
    const [tenants, total] = await repo.findAndCount({
      order: { hostname: 'ASC' },
      skip,
      take: limit,
    });

    res.status(200).json({
      tenants: tenants.map(serializeTenant),
      page,
      limit,
      total,
    });
    return;
  }

  if (req.method === 'POST') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const hostname = normalizeHostname(req.body?.hostname);
    const isSuspended = normalizeBoolean(req.body?.isSuspended, false);
    const allowRegistration = normalizeBoolean(req.body?.allowRegistration, true);
    const resourceConfig = normalizeResourceConfig(req.body?.resourceConfig, DEFAULT_RESOURCE_CONFIG);
    const configObject = parseAdapterConfigObject(req.body?.adapterConfig);
    const resolvedConfig = configObject
      ? await resolveMaskedPasswords(configObject, CoreDataSource)
      : null;
    const adapterConfig = parseAdapterConfig(resolvedConfig);
    const adapterAccess = adapterConfig.adapterAccess;

    const repo = CoreDataSource.getRepository(Tenant);
    const existing = await repo.findOne({ where: { hostname } });
    if (existing) {
      res.status(409).json({ error: 'Tenant with this hostname already exists' });
      return;
    }

    const tenant = repo.create({
      hostname,
      isSuspended,
      allowRegistration,
      resourceConfig,
      adapterAccess,
      adapterConfig: resolvedConfig ? maskPasswordFields(resolvedConfig) : {},
    });
    await repo.save(tenant);
    if (adapterConfig.secrets) {
      const secretRepo = CoreDataSource.getRepository(Secret);
      for (const [keyName, value] of Object.entries(adapterConfig.secrets)) {
        const encrypted = encryptSecret(value);
        const secret = secretRepo.create({
          tenant,
          keyName,
          encryptedValue: encrypted.encryptedValue,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
        });
        await secretRepo.save(secret);
      }
    }

    res.status(201).json({ tenant: serializeTenant(tenant) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
