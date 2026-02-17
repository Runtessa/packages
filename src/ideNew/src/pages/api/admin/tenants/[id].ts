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
const DEFAULT_SSO_SECRET_KEYS = {
  clientId: 'auth:sso:client_id',
  clientSecret: 'auth:sso:client_secret',
  tenantToken: 'auth:sso:tenant_token',
} as const;
const DEFAULT_SSO_SCOPE = 'openid profile email';

type TenantSsoSecretKeys = {
  clientId: string;
  clientSecret: string;
  tenantToken: string;
};

type TenantSsoRegistrationResponse = {
  tenant?: {
    tenantName?: string;
    tenantRandId?: string;
    allowRegistration?: boolean;
    callbackUrl?: string;
  };
  oauthClient?: {
    clientId?: string;
    clientSecret?: string | null;
    scope?: string;
    allowedRedirectUri?: string;
    credentialsRotated?: boolean;
  };
  tenantSsoToken?: string | null;
  secretKeys?: Partial<TenantSsoSecretKeys>;
  authBaseUrl?: string;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeSsoSecretKeys = (raw: unknown): TenantSsoSecretKeys => {
  const source = asObject(raw);
  return {
    clientId: String(source.clientId || DEFAULT_SSO_SECRET_KEYS.clientId).trim() || DEFAULT_SSO_SECRET_KEYS.clientId,
    clientSecret:
      String(source.clientSecret || DEFAULT_SSO_SECRET_KEYS.clientSecret).trim() ||
      DEFAULT_SSO_SECRET_KEYS.clientSecret,
    tenantToken:
      String(source.tenantToken || DEFAULT_SSO_SECRET_KEYS.tenantToken).trim() ||
      DEFAULT_SSO_SECRET_KEYS.tenantToken,
  };
};

const readTenantSsoBlock = (config: unknown): Record<string, unknown> => {
  const root = asObject(config);
  const auth = asObject(root.auth);
  const topLevel = asObject(root.sso);
  const underAuth = asObject(auth.sso);
  return { ...topLevel, ...underAuth };
};

const readTenantSsoEnabled = (config: unknown): boolean => {
  const sso = readTenantSsoBlock(config);
  if (typeof sso.enabled === 'boolean') return sso.enabled;
  if (typeof sso.enabled === 'string') {
    const normalized = sso.enabled.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return Boolean(
    sso.authBaseUrl ||
      sso.clientIdSecretKey ||
      sso.client_id_secret_key ||
      sso.clientSecretSecretKey ||
      sso.client_secret_secret_key ||
      sso.tenantTokenSecretKey ||
      sso.tenant_token_secret_key
  );
};

const readTenantSsoSecretKeys = (config: unknown): TenantSsoSecretKeys => {
  const sso = readTenantSsoBlock(config);
  return {
    clientId:
      String(
        sso.clientIdSecretKey ||
          sso.client_id_secret_key ||
          DEFAULT_SSO_SECRET_KEYS.clientId
      ).trim() || DEFAULT_SSO_SECRET_KEYS.clientId,
    clientSecret:
      String(
        sso.clientSecretSecretKey ||
          sso.client_secret_secret_key ||
          DEFAULT_SSO_SECRET_KEYS.clientSecret
      ).trim() || DEFAULT_SSO_SECRET_KEYS.clientSecret,
    tenantToken:
      String(
        sso.tenantTokenSecretKey ||
          sso.tenant_token_secret_key ||
          DEFAULT_SSO_SECRET_KEYS.tenantToken
      ).trim() || DEFAULT_SSO_SECRET_KEYS.tenantToken,
  };
};

const mergeTenantSsoConfig = (
  adapterConfig: Record<string, unknown>,
  input: {
    enabled: boolean;
    authBaseUrl?: string;
    scope?: string;
    secretKeys?: TenantSsoSecretKeys;
  }
): Record<string, unknown> => {
  const root = asObject(adapterConfig);
  const auth = asObject(root.auth);
  const current = readTenantSsoBlock(root);
  const secretKeys = input.secretKeys || readTenantSsoSecretKeys(root);
  const mergedSso = {
    ...current,
    enabled: input.enabled,
    authBaseUrl:
      (input.authBaseUrl && String(input.authBaseUrl).trim()) ||
      String(current.authBaseUrl || '').trim(),
    scope:
      (input.scope && String(input.scope).trim()) ||
      String(current.scope || DEFAULT_SSO_SCOPE).trim() ||
      DEFAULT_SSO_SCOPE,
    clientIdSecretKey: secretKeys.clientId,
    clientSecretSecretKey: secretKeys.clientSecret,
    tenantTokenSecretKey: secretKeys.tenantToken,
  };
  const nextAuth = {
    ...auth,
    sso: mergedSso,
  };
  return {
    ...root,
    sso: mergedSso,
    auth: nextAuth,
  };
};

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

const normalizeBoolean = (raw: unknown, fallback: boolean, label = 'value') => {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  const err = new Error(`${label} must be a boolean`);
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

const registerTenantSsoInAuthService = async (params: {
  tenantId: string;
  tenantHostname: string;
  allowRegistration: boolean;
  tenantDisplayName?: string;
  callbackUrl?: string;
  rotateCredentials: boolean;
}): Promise<TenantSsoRegistrationResponse> => {
  const authServiceUrl = String(process.env.IDE_AUTH_SERVICE_URL || '').trim();
  const authServiceToken = String(process.env.IDE_AUTH_SERVICE_TOKEN || '').trim();

  if (!authServiceUrl) {
    const error = new Error('IDE_AUTH_SERVICE_URL is not configured');
    (error as any).statusCode = 500;
    throw error;
  }
  if (!authServiceToken) {
    const error = new Error('IDE_AUTH_SERVICE_TOKEN is not configured');
    (error as any).statusCode = 500;
    throw error;
  }

  let endpoint: URL;
  try {
    endpoint = new URL('/api/internal/tenant-sso/register', authServiceUrl);
  } catch {
    const error = new Error('IDE_AUTH_SERVICE_URL is invalid');
    (error as any).statusCode = 500;
    throw error;
  }

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authServiceToken}`,
    },
    body: JSON.stringify({
      tenant_name: params.tenantHostname,
      tenant_rand_id: params.tenantId,
      allow_registration: params.allowRegistration,
      tenant_display_name: params.tenantDisplayName || params.tenantHostname,
      callback_url: params.callbackUrl || `https://${params.tenantHostname}/auth`,
      rotate_credentials: params.rotateCredentials,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as TenantSsoRegistrationResponse & {
    error?: string;
  };
  if (!response.ok) {
    const error = new Error(payload?.error || `Auth service registration failed (${response.status})`);
    (error as any).statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }

  return payload;
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
  ssoEnabled: readTenantSsoEnabled(tenant.adapterConfig ?? {}),
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
    const nextSuspended = normalizeBoolean(req.body?.isSuspended, tenant.isSuspended, 'isSuspended');
    const nextAllowRegistration = normalizeBoolean(
      req.body?.allowRegistration,
      tenant.allowRegistration ?? true,
      'allowRegistration'
    );
    const currentAdapterConfig = asObject(tenant.adapterConfig ?? {});
    const currentSsoEnabled = readTenantSsoEnabled(currentAdapterConfig);
    const nextSsoEnabled = normalizeBoolean(req.body?.ssoEnabled, currentSsoEnabled, 'ssoEnabled');
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
    const baseAdapterConfig = deepClone<Record<string, unknown>>(
      resolvedConfig ? asObject(resolvedConfig) : currentAdapterConfig
    );
    const baseSsoSecretKeys = readTenantSsoSecretKeys(baseAdapterConfig);

    if (nextHostname !== tenant.hostname) {
      const duplicate = await repo.findOne({ where: { hostname: nextHostname } });
      if (duplicate && duplicate.id !== tenant.id) {
        res.status(409).json({ error: 'Tenant with this hostname already exists' });
        return;
      }
    }

    const secretRepo = CoreDataSource.getRepository(Secret);
    const requiredSsoSecretKeys = Array.from(
      new Set([
        baseSsoSecretKeys.clientId,
        baseSsoSecretKeys.clientSecret,
        baseSsoSecretKeys.tenantToken,
      ].filter(Boolean))
    );
    const existingSsoSecretRows =
      requiredSsoSecretKeys.length > 0
        ? await secretRepo.find({
            where: requiredSsoSecretKeys.map((keyName) => ({
              tenant: { id: tenant.id },
              keyName,
            })),
          })
        : [];
    const hasAllRequiredSsoSecrets =
      requiredSsoSecretKeys.length > 0 &&
      existingSsoSecretRows.length >= requiredSsoSecretKeys.length;
    const shouldRotateCredentials = nextSsoEnabled && (!currentSsoEnabled || !hasAllRequiredSsoSecrets);

    let ssoRegistration: TenantSsoRegistrationResponse | null = null;
    if (nextSsoEnabled) {
      const useHttpForLocalTenant =
        /^localhost$/i.test(nextHostname) ||
        /^127\.0\.0\.1$/.test(nextHostname) ||
        /^(\d{1,3}\.){3}\d{1,3}$/.test(nextHostname);
      const callbackProtocol = useHttpForLocalTenant ? 'http' : 'https';
      ssoRegistration = await registerTenantSsoInAuthService({
        tenantId: tenant.id,
        tenantHostname: nextHostname,
        allowRegistration: nextAllowRegistration,
        tenantDisplayName: nextHostname,
        callbackUrl: `${callbackProtocol}://${nextHostname}/auth`,
        rotateCredentials: shouldRotateCredentials,
      });
    }

    const mergedSsoSecretKeys = normalizeSsoSecretKeys({
      clientId: ssoRegistration?.secretKeys?.clientId || baseSsoSecretKeys.clientId,
      clientSecret: ssoRegistration?.secretKeys?.clientSecret || baseSsoSecretKeys.clientSecret,
      tenantToken: ssoRegistration?.secretKeys?.tenantToken || baseSsoSecretKeys.tenantToken,
    });

    const nextAdapterConfig =
      nextSsoEnabled || currentSsoEnabled || req.body?.ssoEnabled !== undefined
        ? mergeTenantSsoConfig(baseAdapterConfig, {
            enabled: nextSsoEnabled,
            authBaseUrl:
              ssoRegistration?.authBaseUrl ||
              String(process.env.CORE_SSO_AUTH_BASE_URL || '').trim() ||
              String(process.env.IDE_AUTH_SERVICE_URL || '').trim(),
            scope: ssoRegistration?.oauthClient?.scope || DEFAULT_SSO_SCOPE,
            secretKeys: mergedSsoSecretKeys,
          })
        : baseAdapterConfig;

    const parsedAdapterConfig = parseAdapterConfig(nextAdapterConfig);
    const nextAdapterAccess =
      Object.keys(parsedAdapterConfig.adapterAccess).length > 0
        ? parsedAdapterConfig.adapterAccess
        : tenant.adapterAccess ?? {};

    const secretsToPersist: Record<string, string> = {
      ...(parsedAdapterConfig.secrets || {}),
    };
    if (nextSsoEnabled && ssoRegistration?.oauthClient?.clientId) {
      secretsToPersist[mergedSsoSecretKeys.clientId] = ssoRegistration.oauthClient.clientId;
    }
    if (nextSsoEnabled && ssoRegistration?.oauthClient?.clientSecret) {
      secretsToPersist[mergedSsoSecretKeys.clientSecret] = ssoRegistration.oauthClient.clientSecret;
    }
    if (nextSsoEnabled && ssoRegistration?.tenantSsoToken) {
      secretsToPersist[mergedSsoSecretKeys.tenantToken] = ssoRegistration.tenantSsoToken;
    }

    if (nextSsoEnabled && shouldRotateCredentials) {
      if (!secretsToPersist[mergedSsoSecretKeys.clientId]) {
        const err = new Error('Auth service did not return SSO client id');
        (err as any).statusCode = 502;
        throw err;
      }
      if (!secretsToPersist[mergedSsoSecretKeys.clientSecret]) {
        const err = new Error('Auth service did not return SSO client secret');
        (err as any).statusCode = 502;
        throw err;
      }
      if (!secretsToPersist[mergedSsoSecretKeys.tenantToken]) {
        const err = new Error('Auth service did not return tenant SSO token');
        (err as any).statusCode = 502;
        throw err;
      }
    }

    tenant.hostname = nextHostname;
    tenant.isSuspended = nextSuspended;
    tenant.allowRegistration = nextAllowRegistration;
    tenant.resourceConfig = nextResourceConfig;
    tenant.authDbConfig = nextAuthDbConfig;
    tenant.adapterAccess = nextAdapterAccess;
    tenant.adapterConfig = maskPasswordFields(nextAdapterConfig);
    await repo.save(tenant);

    for (const [keyName, value] of Object.entries(secretsToPersist)) {
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
