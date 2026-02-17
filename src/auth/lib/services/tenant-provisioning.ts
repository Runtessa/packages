import { AuthDataSource } from '../db';
import { config } from '../config';
import { hashPassword, randomId } from '../crypto';
import { OAuthClientEntity } from '../typeorm/entities';
import { createOrUpdateWhitelistTenant, normalizeTenantName } from './tenant-whitelist';
import { Repository } from 'typeorm';

const DEFAULT_ALLOWED_SCOPES = ['openid', 'profile', 'email', 'tenant.sync'];

export const DEFAULT_SSO_SECRET_KEYS = {
  clientId: 'auth:sso:client_id',
  clientSecret: 'auth:sso:client_secret',
  tenantToken: 'auth:sso:tenant_token',
} as const;

type ProvisionTenantSsoInput = {
  tenantName: string;
  tenantRandId: string;
  allowRegistration: boolean;
  tenantDisplayName?: string | null;
  callbackUrl?: string | null;
  rotateCredentials?: boolean;
};

type ProvisionTenantSsoResult = {
  tenant: {
    tenantName: string;
    tenantRandId: string;
    allowRegistration: boolean;
    callbackUrl: string;
    tenantDisplayName: string | null;
  };
  oauthClient: {
    clientId: string;
    clientSecret: string | null;
    allowedRedirectUri: string;
    scope: string;
    isNewClient: boolean;
    credentialsRotated: boolean;
  };
  tenantSsoToken: string | null;
  secretKeys: typeof DEFAULT_SSO_SECRET_KEYS;
  authBaseUrl: string;
};

const isLikelyLocalHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) return true;
  if (normalized.endsWith('.local')) return true;
  return false;
};

const normalizeTenantCallbackUrl = (tenantName: string, callbackUrl?: string | null): string => {
  if (!callbackUrl) {
    const protocol = isLikelyLocalHost(tenantName) ? 'http' : 'https';
    return `${protocol}://${tenantName}/auth`;
  }

  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    const error = new Error('callback_url is invalid');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const callbackTenantName = normalizeTenantName(parsed.hostname);
  if (callbackTenantName !== tenantName) {
    const error = new Error('callback_url host must match tenant_name');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  parsed.pathname = '/auth';
  parsed.search = '';
  parsed.hash = '';
  return `${parsed.origin}/auth`;
};

const buildManagedClientId = (tenantName: string): string => {
  const sanitized = tenantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  const suffix = sanitized || 'tenant';
  return `idp-tenant-${suffix}`.slice(0, 120);
};

const withRandomSuffix = (value: string): string => {
  const suffix = `-${randomId(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'idp'}`;
  return `${value.slice(0, 120 - suffix.length)}${suffix}`;
};

const resolveClientId = async (
  repo: Repository<OAuthClientEntity>,
  preferredClientId: string,
  currentClientId?: string,
): Promise<string> => {
  let candidate = preferredClientId.slice(0, 120);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await repo.findOne({ where: { clientId: candidate } });
    if (!existing || existing.clientId === currentClientId) {
      return candidate;
    }
    candidate = withRandomSuffix(preferredClientId.slice(0, 120));
  }
  const error = new Error('Failed to allocate unique client id');
  (error as Error & { statusCode: number }).statusCode = 500;
  throw error;
};

const findManagedClientByTenant = async (
  repo: Repository<OAuthClientEntity>,
  tenantRandId: string,
): Promise<OAuthClientEntity | null> => {
  return repo
    .createQueryBuilder('client')
    .where('client.tenant_rand_id = :tenantRandId', { tenantRandId })
    .andWhere("client.meta ->> 'managedBy' = :managedBy", { managedBy: 'ide' })
    .orderBy('client.created_at', 'ASC')
    .getOne();
};

export const provisionTenantSso = async ({
  tenantName,
  tenantRandId,
  allowRegistration,
  tenantDisplayName,
  callbackUrl,
  rotateCredentials = false,
}: ProvisionTenantSsoInput): Promise<ProvisionTenantSsoResult> => {
  const normalizedTenantName = normalizeTenantName(tenantName);
  const normalizedTenantRandId = String(tenantRandId || '').trim();
  if (!normalizedTenantRandId) {
    const error = new Error('tenant_rand_id is required');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const redirectUri = normalizeTenantCallbackUrl(normalizedTenantName, callbackUrl);
  const normalizedDisplayName = String(tenantDisplayName || '').trim() || null;

  const whitelistToken = rotateCredentials ? randomId(32) : undefined;
  const whitelist = await createOrUpdateWhitelistTenant({
    tenantName: normalizedTenantName,
    tenantRandId: normalizedTenantRandId,
    isActive: true,
    token: whitelistToken,
    meta: {
      allowRegistration,
      tenantDisplayName: normalizedDisplayName || normalizedTenantName,
      managedBy: 'ide',
    },
  });

  const clientRepo = AuthDataSource.getRepository(OAuthClientEntity);
  const existingManaged = await findManagedClientByTenant(clientRepo, normalizedTenantRandId);
  const preferredClientId = existingManaged?.clientId || buildManagedClientId(normalizedTenantName);
  const resolvedClientId = await resolveClientId(clientRepo, preferredClientId, existingManaged?.clientId);
  const isNewClient = !existingManaged;

  const client = existingManaged || clientRepo.create({ randId: randomId(16) });
  client.clientId = resolvedClientId;
  client.tenantRandId = normalizedTenantRandId;
  client.name = `${normalizedDisplayName || normalizedTenantName} Tenant Client`;
  client.allowedRedirectUris = [redirectUri];
  client.allowedScopes = DEFAULT_ALLOWED_SCOPES;
  client.requirePkce = true;
  client.isActive = true;
  client.meta = {
    ...(client.meta || {}),
    managedBy: 'ide',
    tenantName: normalizedDisplayName || normalizedTenantName,
    allowRegistration,
    tenantCode: normalizedTenantName,
    tenantHost: normalizedTenantName,
  };

  let plainClientSecret: string | null = null;
  const credentialsRotated = isNewClient || rotateCredentials || !client.clientSecretHash;
  if (credentialsRotated) {
    plainClientSecret = randomId(32);
    client.clientSecretHash = await hashPassword(plainClientSecret);
  }

  await clientRepo.save(client);

  return {
    tenant: {
      tenantName: normalizedTenantName,
      tenantRandId: normalizedTenantRandId,
      allowRegistration,
      callbackUrl: redirectUri,
      tenantDisplayName: normalizedDisplayName,
    },
    oauthClient: {
      clientId: client.clientId,
      clientSecret: plainClientSecret,
      allowedRedirectUri: redirectUri,
      scope: DEFAULT_ALLOWED_SCOPES.join(' '),
      isNewClient,
      credentialsRotated,
    },
    tenantSsoToken: whitelist.plainToken,
    secretKeys: DEFAULT_SSO_SECRET_KEYS,
    authBaseUrl: config.baseUrl,
  };
};
