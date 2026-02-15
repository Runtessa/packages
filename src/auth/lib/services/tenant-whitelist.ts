import { AuthDataSource } from '../db';
import { hashValue, randomId, safeEqual } from '../crypto';
import { TenantWhitelistEntity } from '../typeorm/entities';

const normalizeTenantName = (value: string): string => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    const error = new Error('tenant_name is required');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    const error = new Error('tenant_name is invalid');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  return normalized;
};

export const listWhitelist = async (): Promise<TenantWhitelistEntity[]> => {
  return AuthDataSource.getRepository(TenantWhitelistEntity).find({
    order: {
      tenantName: 'ASC',
    },
  });
};

export const findWhitelistTenant = async (tenantName: string): Promise<TenantWhitelistEntity | null> => {
  const normalized = normalizeTenantName(tenantName);
  return AuthDataSource.getRepository(TenantWhitelistEntity).findOne({
    where: { tenantName: normalized },
  });
};

export const createOrUpdateWhitelistTenant = async ({
  tenantName,
  tenantRandId,
  isActive,
  token,
  meta,
}: {
  tenantName: string;
  tenantRandId?: string | null;
  isActive?: boolean;
  token?: string;
  meta?: Record<string, unknown>;
}): Promise<{ row: TenantWhitelistEntity; plainToken: string | null }> => {
  const repo = AuthDataSource.getRepository(TenantWhitelistEntity);
  const normalizedName = normalizeTenantName(tenantName);

  const existing = await repo.findOne({ where: { tenantName: normalizedName } });
  const plainToken = token || randomId(32);

  const entity = existing || repo.create({ tenantName: normalizedName });
  entity.tenantName = normalizedName;
  entity.tenantRandId = tenantRandId || entity.tenantRandId || null;
  entity.isActive = typeof isActive === 'boolean' ? isActive : existing?.isActive ?? true;
  entity.meta = meta ? { ...(existing?.meta || {}), ...meta } : existing?.meta || {};

  if (token || !existing) {
    entity.ssoTokenHash = hashValue(plainToken);
  }

  const saved = await repo.save(entity);

  return {
    row: saved,
    plainToken: token || !existing ? plainToken : null,
  };
};

export const rotateWhitelistTenantToken = async (
  tenantName: string,
): Promise<{ row: TenantWhitelistEntity; plainToken: string }> => {
  const existing = await findWhitelistTenant(tenantName);
  if (!existing) {
    const error = new Error('Tenant whitelist entry not found');
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  const plainToken = randomId(32);
  existing.ssoTokenHash = hashValue(plainToken);

  const saved = await AuthDataSource.getRepository(TenantWhitelistEntity).save(existing);
  return { row: saved, plainToken };
};

export const deleteWhitelistTenant = async (tenantName: string): Promise<void> => {
  const normalized = normalizeTenantName(tenantName);
  await AuthDataSource.getRepository(TenantWhitelistEntity).delete({ tenantName: normalized });
};

export const verifyTenantSsoToken = async (
  tenantName: string,
  token: string,
): Promise<TenantWhitelistEntity | null> => {
  const entry = await findWhitelistTenant(tenantName);
  if (!entry || !entry.isActive) return null;
  if (!token) return null;

  const hashed = hashValue(token);
  return safeEqual(entry.ssoTokenHash, hashed) ? entry : null;
};

export const isWhitelistedTenantHost = async (host: string): Promise<boolean> => {
  try {
    const normalized = normalizeTenantName(host);
    const entry = await findWhitelistTenant(normalized);
    return Boolean(entry?.isActive);
  } catch {
    return false;
  }
};

export const isWhitelistedOrigin = async (origin: string): Promise<boolean> => {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return isWhitelistedTenantHost(parsed.hostname);
  } catch {
    return false;
  }
};

export const extractTenantNameFromRedirectUri = (redirectUri: string): string => {
  try {
    const url = new URL(redirectUri);
    return normalizeTenantName(url.hostname);
  } catch {
    const error = new Error('Invalid redirect_uri');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
};

export { normalizeTenantName };
