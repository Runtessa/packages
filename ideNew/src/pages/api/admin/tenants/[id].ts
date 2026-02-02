import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { Secret } from '@idp/shared';
import { encryptSecret } from '@/lib/crypto';
import { maskPasswordFields, resolveMaskedPasswords } from '@/lib/adapter-config-passwords';
import { parseAdapterConfig } from '@/lib/tenant-adapter-config';
import { Tenant } from '@idp/shared';

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
    const secretRepo = CoreDataSource.getRepository(Secret);
    const secrets = await secretRepo.find({
      where: { tenant: { id: tenant.id } },
      order: { keyName: 'ASC' },
    });
    res.status(200).json({
      tenant: serializeTenant(tenant),
      secrets: secrets.map((secret) => ({ keyName: secret.keyName, updatedAt: secret.updatedAt })),
    });
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
    const nextAllowRegistration = normalizeBoolean(
      req.body?.allowRegistration,
      tenant.allowRegistration ?? true
    );
    const nextResourceConfig = normalizeResourceConfig(
      req.body?.resourceConfig,
      tenant.resourceConfig ?? DEFAULT_RESOURCE_CONFIG
    );
    const configObject = parseAdapterConfigObject(req.body?.adapterConfig);
    const resolvedConfig = configObject
      ? await resolveMaskedPasswords(configObject, CoreDataSource, tenant)
      : null;
    const adapterConfig = parseAdapterConfig(resolvedConfig);
    const nextAdapterAccess =
      Object.keys(adapterConfig.adapterAccess).length > 0
        ? adapterConfig.adapterAccess
        : tenant.adapterAccess ?? {};

    if (nextHostname !== tenant.hostname) {
      const duplicate = await repo.findOne({ where: { hostname: nextHostname } });
      if (duplicate && duplicate.id !== tenant.id) {
        res.status(409).json({ error: 'Tenant with this hostname already exists' });
        return;
      }
    }

    tenant.hostname = nextHostname;
    tenant.isSuspended = nextSuspended;
    tenant.allowRegistration = nextAllowRegistration;
    tenant.resourceConfig = nextResourceConfig;
    tenant.adapterAccess = nextAdapterAccess;
    tenant.adapterConfig = resolvedConfig ? maskPasswordFields(resolvedConfig) : tenant.adapterConfig ?? {};
    await repo.save(tenant);

    if (adapterConfig.secrets) {
      const secretRepo = CoreDataSource.getRepository(Secret);
      for (const [keyName, value] of Object.entries(adapterConfig.secrets)) {
        const encrypted = encryptSecret(value);
        let secret = await secretRepo.findOne({
          where: { tenant: { id: tenant.id }, keyName },
        });
        if (!secret) {
          secret = secretRepo.create({
            tenant,
            keyName,
            encryptedValue: encrypted.encryptedValue,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
          });
        } else {
          secret.encryptedValue = encrypted.encryptedValue;
          secret.iv = encrypted.iv;
          secret.authTag = encrypted.authTag;
        }
        await secretRepo.save(secret);
      }
    }

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
