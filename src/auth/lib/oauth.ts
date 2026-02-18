import { AuthDataSource } from './db';
import { config } from './config';
import { verifyPassword } from './crypto';
import { OAuthClientEntity } from './typeorm/entities';
import {
  extractTenantNameFromRedirectUri,
  findWhitelistTenant,
  normalizeTenantName,
  verifyTenantSsoToken,
} from './services/tenant-whitelist';

export interface TenantPolicy {
  tenantRandId: string;
  tenantName: string | null;
  allowRegistration: boolean;
  tenantCode: string | null;
  tenantDisplayName: string | null;
  source: 'remote' | 'client_meta';
}

export const splitScope = (scope: unknown): string[] =>
  String(scope || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const normalizeScope = (scope: unknown, fallback: string[] = ['openid']): string => {
  const requested = splitScope(scope);
  const deduplicated = [...new Set(requested.length ? requested : fallback)];
  return deduplicated.join(' ');
};

export const readClientById = async (clientId: string): Promise<OAuthClientEntity | null> => {
  return AuthDataSource.getRepository(OAuthClientEntity).findOne({
    where: { clientId },
  });
};

const policyFromClientMeta = (
  client: OAuthClientEntity,
  tenantName: string | null,
  whitelistMeta?: Record<string, unknown>,
): TenantPolicy => {
  const meta = (client.meta || {}) as Record<string, unknown>;
  const allowRegistration =
    typeof whitelistMeta?.allowRegistration === 'boolean'
      ? whitelistMeta.allowRegistration
      : Boolean(meta.allowRegistration);

  return {
    tenantRandId: client.tenantRandId,
    tenantName,
    allowRegistration,
    tenantCode: typeof meta.tenantCode === 'string' ? meta.tenantCode : null,
    tenantDisplayName:
      typeof whitelistMeta?.tenantDisplayName === 'string'
        ? whitelistMeta.tenantDisplayName
        : typeof meta.tenantName === 'string'
          ? meta.tenantName
          : null,
    source: 'client_meta',
  };
};

const fetchTenantPolicyFromRemote = async (
  client: OAuthClientEntity,
  tenantName: string | null,
): Promise<TenantPolicy | null> => {
  if (!config.tenantPolicy.url) return null;

  const url = new URL(config.tenantPolicy.url);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('tenant_rand_id', client.tenantRandId);
  if (tenantName) {
    url.searchParams.set('tenant_name', tenantName);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (config.tenantPolicy.token) {
    headers.Authorization = `Bearer ${config.tenantPolicy.token}`;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.tenantPolicy.timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`Tenant policy endpoint responded with ${response.status}`);
      (error as Error & { statusCode: number }).statusCode = 503;
      throw error;
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (typeof data.allowRegistration !== 'boolean') {
      const error = new Error('Tenant policy response missing allowRegistration boolean');
      (error as Error & { statusCode: number }).statusCode = 503;
      throw error;
    }

    return {
      tenantRandId: client.tenantRandId,
      tenantName,
      allowRegistration: data.allowRegistration,
      tenantCode: typeof data.tenantCode === 'string' ? data.tenantCode : null,
      tenantDisplayName: typeof data.tenantName === 'string' ? data.tenantName : null,
      source: 'remote',
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
};

export const resolveTenantPolicyByClientId = async (
  clientId: string,
  tenantNameHint?: string | null,
): Promise<{ client: OAuthClientEntity; policy: TenantPolicy } | null> => {
  const client = await readClientById(clientId);
  if (!client || !client.isActive) return null;

  const normalizedTenantName = tenantNameHint ? normalizeTenantName(tenantNameHint) : null;
  const whitelistEntry = normalizedTenantName
    ? await findWhitelistTenant(normalizedTenantName)
    : null;

  if (normalizedTenantName && (!whitelistEntry || !whitelistEntry.isActive)) {
    const error = new Error('Tenant is not whitelisted for SSO');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  if (
    normalizedTenantName &&
    whitelistEntry?.tenantRandId &&
    whitelistEntry.tenantRandId !== client.tenantRandId
  ) {
    const error = new Error('Tenant is not mapped to this OAuth client');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  try {
    const remotePolicy = await fetchTenantPolicyFromRemote(client, normalizedTenantName);
    if (remotePolicy) {
      return { client, policy: remotePolicy };
    }
  } catch (error) {
    if (config.tenantPolicy.requireRemote) throw error;
  }

  if (config.tenantPolicy.requireRemote) {
    const error = new Error('Remote tenant policy is required but unavailable');
    (error as Error & { statusCode: number }).statusCode = 503;
    throw error;
  }

  return {
    client,
    policy: policyFromClientMeta(client, normalizedTenantName, whitelistEntry?.meta),
  };
};

export const assertScopeAllowed = (client: OAuthClientEntity, rawScope: unknown): string => {
  const requested = splitScope(rawScope);
  const allowed = new Set(client.allowedScopes || []);
  for (const token of requested) {
    if (!allowed.has(token)) {
      const error = new Error(`Scope not allowed: ${token}`);
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
  }
  return normalizeScope(rawScope, ['openid']);
};

export const verifyClientSecret = async (
  client: OAuthClientEntity | null,
  candidateSecret: string,
): Promise<boolean> => {
  if (!client || !client.clientSecretHash) return false;
  return verifyPassword(candidateSecret, client.clientSecretHash);
};

export const validateAuthorizeRedirect = async (
  client: OAuthClientEntity,
  redirectUri: string,
): Promise<{ tenantName: string }> => {
  const tenantName = extractTenantNameFromRedirectUri(redirectUri);
  const whitelistEntry = await findWhitelistTenant(tenantName);

  if (!whitelistEntry || !whitelistEntry.isActive) {
    const error = new Error('Tenant callback host is not whitelisted');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  if (whitelistEntry.tenantRandId && whitelistEntry.tenantRandId !== client.tenantRandId) {
    const error = new Error('Tenant callback is not mapped to this OAuth client');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  const url = new URL(redirectUri);
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath !== '/auth') {
    const error = new Error('redirect_uri must match tenant /auth pattern');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const allowedPath = (client.allowedRedirectUris || []).some((candidate) => {
    try {
      const candidateUrl = new URL(candidate);
      const candidatePath = candidateUrl.pathname.replace(/\/+$/, '') || '/';
      return candidatePath === normalizedPath;
    } catch {
      return false;
    }
  });

  if (!allowedPath) {
    const error = new Error('redirect_uri path is not allowed for this client');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  if (config.isProduction && url.protocol !== 'https:') {
    const error = new Error('redirect_uri must use https in production');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  return { tenantName };
};

export const validateTenantSsoTokenForClient = async ({
  tenantName,
  tenantSsoToken,
  client,
}: {
  tenantName: string;
  tenantSsoToken: string;
  client: OAuthClientEntity;
}): Promise<void> => {
  const entry = await verifyTenantSsoToken(tenantName, tenantSsoToken);
  if (!entry) {
    const error = new Error('Invalid tenant SSO token');
    (error as Error & { statusCode: number }).statusCode = 401;
    throw error;
  }

  if (entry.tenantRandId && entry.tenantRandId !== client.tenantRandId) {
    const error = new Error('Tenant token does not match OAuth client tenant');
    (error as Error & { statusCode: number }).statusCode = 401;
    throw error;
  }
};

export {
  consumeAuthorizationCode,
  createAccessToken,
  createAuthorizationCode,
  parseClientAuth,
  readAccessToken,
} from './oauthTokens';
