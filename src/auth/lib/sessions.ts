import { Request, Response } from 'express';
import { MoreThan, IsNull } from 'typeorm';
import { config } from './config';
import { AuthDataSource } from './db';
import { hashValue, randomId } from './crypto';
import { AuthSessionEntity, UserEntity } from './typeorm/entities';

export interface SessionContext {
  session: AuthSessionEntity;
  user: UserEntity;
}

const sessionExpiry = (): Date => new Date(Date.now() + config.session.ttlSec * 1000);
const idleExpiry = (): Date => new Date(Date.now() + config.session.idleTtlSec * 1000);

export const createSession = async ({
  userRandId,
  tenantRandId,
  ipAddress,
  userAgent,
}: {
  userRandId: string;
  tenantRandId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ sessionToken: string; sessionEntity: AuthSessionEntity }> => {
  const sessionToken = randomId(48);
  const sessionRepo = AuthDataSource.getRepository(AuthSessionEntity);

  const entity = sessionRepo.create({
    randId: randomId(18),
    sessionTokenHash: hashValue(sessionToken),
    userRandId,
    tenantRandId,
    csrfToken: randomId(24),
    ipAddress,
    userAgent,
    expiresAt: sessionExpiry(),
    idleExpiresAt: idleExpiry(),
    revokedAt: null,
  });

  const saved = await sessionRepo.save(entity);
  return { sessionToken, sessionEntity: saved };
};

export const readSessionFromToken = async (sessionToken: string): Promise<SessionContext | null> => {
  if (!sessionToken) return null;

  const tokenHash = hashValue(sessionToken);
  const sessionRepo = AuthDataSource.getRepository(AuthSessionEntity);
  const userRepo = AuthDataSource.getRepository(UserEntity);

  const session = await sessionRepo.findOne({
    where: {
      sessionTokenHash: tokenHash,
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
      idleExpiresAt: MoreThan(new Date()),
    },
  });

  if (!session) return null;

  const user = await userRepo.findOne({
    where: { randId: session.userRandId, isCurrent: true },
  });

  if (!user || !user.isActive) return null;

  return { session, user };
};

export const touchSession = async (sessionRandId: string): Promise<void> => {
  await AuthDataSource.getRepository(AuthSessionEntity).update(
    { randId: sessionRandId, revokedAt: IsNull() },
    {
      lastSeenAt: new Date(),
      idleExpiresAt: idleExpiry(),
    },
  );
};

export const renewSession = async (sessionRandId: string): Promise<void> => {
  await AuthDataSource.getRepository(AuthSessionEntity).update(
    { randId: sessionRandId, revokedAt: IsNull() },
    {
      lastSeenAt: new Date(),
      expiresAt: sessionExpiry(),
      idleExpiresAt: idleExpiry(),
    },
  );
};

export const revokeSession = async (sessionRandId: string): Promise<void> => {
  await AuthDataSource.getRepository(AuthSessionEntity).update(
    { randId: sessionRandId, revokedAt: IsNull() },
    { revokedAt: new Date() },
  );
};

const shouldUseSecureCookie = (): boolean => {
  if (!config.cookie.secure) return false;
  if (!config.isDevelopment) return true;
  return !config.cookie.allowInsecureLocalhost;
};

const splitLabels = (host: string): string[] =>
  String(host || '')
    .toLowerCase()
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

const isIpAddress = (host: string): boolean => /^[\d.:]+$/.test(host);
const isLocalHost = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost');

const computeSharedParentDomain = (authHost: string, tenantHost?: string | null): string | undefined => {
  if (!authHost || isLocalHost(authHost) || isIpAddress(authHost)) return undefined;

  const authLabels = splitLabels(authHost);
  if (authLabels.length < 2) return undefined;

  if (!tenantHost) {
    return `.${authLabels.slice(-2).join('.')}`;
  }

  if (isLocalHost(tenantHost) || isIpAddress(tenantHost)) return undefined;

  const tenantLabels = splitLabels(tenantHost);
  if (tenantLabels.length < 2) return undefined;

  const shared: string[] = [];
  let i = 1;
  while (i <= authLabels.length && i <= tenantLabels.length) {
    const a = authLabels[authLabels.length - i];
    const b = tenantLabels[tenantLabels.length - i];
    if (a !== b) break;
    shared.unshift(a);
    i += 1;
  }

  if (shared.length < 2) return undefined;
  return `.${shared.join('.')}`;
};

const resolveCookieDomain = (req: Request, tenantHost?: string | null): string | undefined => {
  if (config.cookie.domain) return config.cookie.domain;
  const authHost = req.hostname || '';
  return computeSharedParentDomain(authHost, tenantHost);
};

export const issueSessionCookie = (
  req: Request,
  res: Response,
  sessionToken: string,
  tenantHost?: string | null,
): void => {
  const domain = resolveCookieDomain(req, tenantHost);
  if (config.cookie.name.startsWith('__Host-') && domain) {
    throw new Error('Cookie domain cannot be set when AUTH_COOKIE_NAME starts with "__Host-"');
  }

  res.cookie(config.cookie.name, sessionToken, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: config.cookie.sameSite,
    signed: true,
    domain,
    path: '/',
    maxAge: config.session.ttlSec * 1000,
  });
};

export const clearSessionCookie = (req: Request, res: Response, tenantHost?: string | null): void => {
  const domain = resolveCookieDomain(req, tenantHost);
  res.clearCookie(config.cookie.name, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: config.cookie.sameSite,
    signed: true,
    domain,
    path: '/',
  });
};

export const readSignedSessionCookie = (req: Request): string => {
  const signedCookies = req.signedCookies as Record<string, string> | undefined;
  return signedCookies?.[config.cookie.name] || '';
};
