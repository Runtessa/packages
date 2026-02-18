import crypto from 'crypto';
import { Request } from 'express';
import { AuthDataSource } from './db';
import { config } from './config';
import { hashValue, randomId } from './crypto';
import {
  OAuthAccessTokenEntity,
  OAuthAuthorizationCodeEntity,
  OAuthClientEntity,
  UserEntity,
} from './typeorm/entities';

export const createAuthorizationCode = async ({
  clientId,
  tenantRandId,
  tenantName,
  tenantOrgRandId,
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
  tenantOrgRandId?: string | null;
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
    tenantOrgRandId: tenantOrgRandId || null,
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
  tenantOrgRandId,
  userRandId,
  scope,
  grantType,
  ipAddress,
}: {
  clientId: string;
  tenantRandId: string;
  tenantName: string;
  tenantOrgRandId?: string | null;
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
    tenantOrgRandId: tenantOrgRandId || null,
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
