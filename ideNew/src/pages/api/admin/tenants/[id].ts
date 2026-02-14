import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { Secret } from '@idp/shared';
import { encryptSecret } from '@/lib/crypto';
import { maskPasswordFields, resolveMaskedPasswords } from '@/lib/adapter-config-passwords';
import { parseAdapterConfig } from '@/lib/tenant-adapter-config';
import { Tenant } from '@idp/shared';
import { TeamTenant } from '@idp/shared';
import {
  assertTenantReadableForUser,
  assertTenantWritableForUser,
  canWriteTenantForUser,
} from '@/lib/team-tenant-access';

const DEFAULT_RESOURCE_CONFIG = { memory: 512, timeout: 5000 };
const DEFAULT_AUTH_DB_CONFIG = { mode: 'shared' as const, secretKey: null as string | null };

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

const normalizeAuthDbConfig = (
  raw: unknown,
  fallback: { mode: 'shared' | 'dedicated'; secretKey?: string | null }
) => {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'object') {
    const err = new Error('authDbConfig must be an object');
    (err as any).statusCode = 400;
    throw err;
  }
  const values = raw as { mode?: unknown; secretKey?: unknown };
  const modeRaw = values.mode ?? fallback.mode;
  if (modeRaw !== 'shared' && modeRaw !== 'dedicated') {
    const err = new Error("authDbConfig.mode must be 'shared' or 'dedicated'");
    (err as any).statusCode = 400;
    throw err;
  }
  const secretKey =
    typeof values.secretKey === 'string' && values.secretKey.trim()
      ? values.secretKey.trim()
      : null;
  if (modeRaw === 'dedicated' && !secretKey) {
    const err = new Error('authDbConfig.secretKey is required when mode is dedicated');
    (err as any).statusCode = 400;
    throw err;
  }
  return {
    mode: modeRaw,
    secretKey: modeRaw === 'shared' ? null : secretKey,
  } as { mode: 'shared' | 'dedicated'; secretKey?: string | null };
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

const serializeTenant = (tenant: Tenant, canWrite: boolean) => ({
  id: tenant.id,
  hostname: tenant.hostname,
  isSuspended: tenant.isSuspended,
  allowRegistration: tenant.allowRegistration ?? true,
  resourceConfig: tenant.resourceConfig,
  adapterAccess: tenant.adapterAccess ?? {},
  adapterConfig: tenant.adapterConfig ?? {},
  authDbConfig: tenant.authDbConfig ?? DEFAULT_AUTH_DB_CONFIG,
  canWrite,
  createdAt: tenant.createdAt,
  updatedAt: tenant.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const user = await requireAdmin(req);
  await ensureCoreSchema();

  const tenantId = getTenantId(req);
  const repo = CoreDataSource.getRepository(Tenant);

  if (req.method === 'GET') {
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    await assertTenantReadableForUser(user, tenant.id);
    const secretRepo = CoreDataSource.getRepository(Secret);
    const secrets = await secretRepo.find({
      where: { tenant: { id: tenant.id } },
      order: { keyName: 'ASC' },
    });
    res.status(200).json({
      tenant: serializeTenant(tenant, canWriteTenantForUser(user)),
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
    await assertTenantWritableForUser(user, tenant.id);

    const nextHostname =
      req.body?.hostname !== undefined ? normalizeHostname(req.body.hostname) : tenant.hostname;
    const nextSuspended = normalizeBoolean(req.body?.isSuspended, tenant.isSuspended);
    const nextAllowRegistration = normalizeBoolean(
      req.body?.allowRegistration,
      tenant.allowRegistration ?? true
    );
    const nextAuthDbConfig = normalizeAuthDbConfig(
      req.body?.authDbConfig,
      tenant.authDbConfig ?? DEFAULT_AUTH_DB_CONFIG
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
    tenant.authDbConfig = nextAuthDbConfig;
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

    res.status(200).json({ tenant: serializeTenant(tenant, true) });
    return;
  }

  if (req.method === 'DELETE') {
    if (!user.isAdmin) {
      const err = new Error('Forbidden: tenant deletion is restricted to platform admins');
      (err as any).statusCode = 403;
      throw err;
    }
    const tenant = await repo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }
    await ensureSchema();
    const mappingRepo = AppDataSource.getRepository(TeamTenant);
    await mappingRepo.delete({ tenantId: tenant.id });
    await repo.remove(tenant);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
