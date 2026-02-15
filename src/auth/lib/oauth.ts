import crypto from 'crypto';
import { Request } from 'express';
import { AuthDataSource } from './db';
import { config } from './config';
import { hashValue, randomId, verifyPassword } from './crypto';
import {
  OAuthAccessTokenEntity,
  OAuthAuthorizationCodeEntity,
  OAuthClientEntity,
  UserEntity,
} from './typeorm/entities';
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

export const createAuthorizationCode = async ({
  clientId,
  tenantRandId,
  tenantName,
  userRandId,
  redirectUri,
  scope,
  codeChallenge,
  codeChallengeMethod,
  state,
}: {
  clientId: string;
  tenantRandId: string;
  tenantName: string;
  userRandId: string;
  redirectUri: string;
  scope: string;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
  state?: string | null;
}): Promise<string> => {
  const rawCode = randomId(48);
  const repo = AuthDataSource.getRepository(OAuthAuthorizationCodeEntity);

  const row = repo.create({
    codeHash: hashValue(rawCode),
    clientId,
    tenantRandId,
    tenantName,
    userRandId,
    redirectUri,
    scope,
    codeChallenge: codeChallenge || null,
    codeChallengeMethod: codeChallengeMethod || null,
    state: state || null,
    expiresAt: new Date(Date.now() + config.oauth.codeTtlSec * 1000),
    consumedAt: null,
  });

  await repo.save(row);
  return rawCode;
};

const assertPkce = (authorizationCode: OAuthAuthorizationCodeEntity, codeVerifier?: string): void => {
  if (!authorizationCode.codeChallenge) return;
  const verifier = String(codeVerifier || '');

  if (!verifier) {
    const error = new Error('code_verifier is required');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const challengeMethod = (authorizationCode.codeChallengeMethod || 'plain').toUpperCase();

  if (challengeMethod === 'PLAIN') {
    if (authorizationCode.codeChallenge !== verifier) {
      const error = new Error('Invalid code_verifier');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
    return;
  }

  if (challengeMethod !== 'S256') {
    const error = new Error('Unsupported code_challenge_method');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');

  if (expected !== authorizationCode.codeChallenge) {
    const error = new Error('Invalid code_verifier');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
};

export const consumeAuthorizationCode = async ({
  code,
  clientId,
  redirectUri,
  codeVerifier,
}: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<OAuthAuthorizationCodeEntity> => {
  const codeHash = hashValue(code);

  return AuthDataSource.transaction(async (manager) => {
    const repo = manager.getRepository(OAuthAuthorizationCodeEntity);
    const row = await repo
      .createQueryBuilder('code')
      .setLock('pessimistic_write')
      .where('code.code_hash = :codeHash', { codeHash })
      .andWhere('code.client_id = :clientId', { clientId })
      .getOne();

    if (!row) {
      const error = new Error('Invalid authorization code');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    if (row.consumedAt) {
      const error = new Error('Authorization code already consumed');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      const error = new Error('Authorization code expired');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    if (row.redirectUri !== redirectUri) {
      const error = new Error('redirect_uri mismatch');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }

    assertPkce(row, codeVerifier);

    row.consumedAt = new Date();
    await repo.save(row);

    return row;
  });
};

export const createAccessToken = async ({
  clientId,
  tenantRandId,
  tenantName,
  userRandId,
  scope,
  grantType,
  ipAddress,
}: {
  clientId: string;
  tenantRandId: string;
  tenantName: string;
  userRandId?: string | null;
  scope: string;
  grantType: string;
  ipAddress?: string | null;
}): Promise<{
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
}> => {
  const rawToken = randomId(48);
  const repo = AuthDataSource.getRepository(OAuthAccessTokenEntity);

  const row = repo.create({
    tokenHash: hashValue(rawToken),
    clientId,
    tenantRandId,
    tenantName,
    userRandId: userRandId || null,
    scope,
    grantType,
    ipAddress: ipAddress || null,
    expiresAt: new Date(Date.now() + config.oauth.accessTokenTtlSec * 1000),
    revokedAt: null,
  });

  await repo.save(row);

  return {
    accessToken: rawToken,
    tokenType: 'Bearer',
    expiresIn: config.oauth.accessTokenTtlSec,
    scope,
  };
};

export const readAccessToken = async (
  rawToken: string,
): Promise<{ token: OAuthAccessTokenEntity; user: UserEntity | null; client: OAuthClientEntity } | null> => {
  if (!rawToken) return null;

  const tokenRepo = AuthDataSource.getRepository(OAuthAccessTokenEntity);
  const clientRepo = AuthDataSource.getRepository(OAuthClientEntity);
  const userRepo = AuthDataSource.getRepository(UserEntity);

  const token = await tokenRepo.findOne({ where: { tokenHash: hashValue(rawToken) } });
  if (!token) return null;
  if (token.revokedAt) return null;
  if (token.expiresAt.getTime() <= Date.now()) return null;

  const client = await clientRepo.findOne({ where: { clientId: token.clientId } });
  if (!client || !client.isActive) return null;

  let user: UserEntity | null = null;
  if (token.userRandId) {
    user = await userRepo.findOne({ where: { randId: token.userRandId, isCurrent: true } });
    if (!user || !user.isActive) return null;
  }

  return { token, user, client };
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

export const parseClientAuth = (req: Request): { clientId: string; clientSecret: string } => {
  const auth = req.headers.authorization || '';

  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator > -1) {
        return {
          clientId: decoded.slice(0, separator),
          clientSecret: decoded.slice(separator + 1),
        };
      }
    } catch {
      // invalid header
    }
  }

  return {
    clientId: String(req.body.client_id || ''),
    clientSecret: String(req.body.client_secret || ''),
  };
};
