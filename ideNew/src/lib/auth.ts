import crypto from 'crypto';
import { NextApiRequest } from 'next';
import { AppDataSource, ensureSchema } from './db';
import { verifyPassword } from './password';
import redis from './redis';
import { logger } from './logger';
import { User } from '@idp/shared';
import { LoginSession } from '@idp/shared';

type AuthHeader = {
  sessionToken?: string;
  apiToken?: string;
};

type AuthUser = {
  id: number;
  email: string;
  role: string;
  token?: string | null;
  isAdmin: boolean;
};

const parseAuthHeader = (req: NextApiRequest): AuthHeader => {
  const header = (req.headers.authorization || req.headers.Authorization) as string | undefined;
  if (!header) return {};
  const [scheme, value] = String(header).split(' ');
  if (!value) return {};
  if (scheme?.toLowerCase() === 'session') return { sessionToken: value };
  if (scheme?.toLowerCase() === 'bearer') return { apiToken: value };
  return {};
};

const getSessionTokenFromCookie = (req: NextApiRequest) => {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sessionToken='));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1] || '');
};

const toAuthUser = (user: User, token?: string | null): AuthUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  token: token ?? null,
  isAdmin: user.role === 'admin'
});

const getUserByApiToken = async (token: string) => {
  await ensureSchema();
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { token } });
  if (!user) return null;
  return toAuthUser(user, token);
};

const getUserBySessionToken = async (token: string) => {
  await ensureSchema();
  const cached = await redis.get(`session:${token}`);
  let userId: number | null = null;

  if (cached) {
    userId = parseInt(cached, 10);
  } else {
    const sessionRepo = AppDataSource.getRepository(LoginSession);
    const session = await sessionRepo.findOne({ where: { token } });
    if (session) {
      userId = session.userId;
      await redis.set(`session:${token}`, userId, 'EX', 30 * 24 * 60 * 60);
    }
  }

  if (!userId) return null;
  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) return null;
  return toAuthUser(user, token);
};

export const requireUser = async (req: NextApiRequest): Promise<AuthUser> => {
  const { sessionToken, apiToken } = parseAuthHeader(req);
  const cookieToken = getSessionTokenFromCookie(req);
  let user: AuthUser | null = null;

  if (sessionToken) user = await getUserBySessionToken(sessionToken);
  else if (cookieToken) user = await getUserBySessionToken(cookieToken);

  if (!user && apiToken) {
    user = await getUserByApiToken(apiToken);
    if (user) {
      user.token = apiToken;
    }
  }

  if (!user) {
    await logger.warn({
      source: 'auth',
      action: 'requireUser',
      message: 'Unauthorized access attempt',
      meta: {
        path: req.url,
        hasSessionToken: Boolean(sessionToken || cookieToken),
        hasApiToken: Boolean(apiToken)
      }
    });
    const err = new Error('Unauthorized');
    (err as any).statusCode = 401;
    throw err;
  }
  await logger.info({
    source: 'auth',
    action: 'requireUser',
    message: 'User authenticated',
    meta: { userId: user.id, path: req.url, via: sessionToken || cookieToken ? 'session' : 'api' }
  });
  return user;
};

export const requireAdmin = async (req: NextApiRequest) => {
  const user = await requireUser(req);
  if (!user.isAdmin) {
    await logger.warn({
      source: 'auth',
      action: 'requireAdmin',
      message: 'Admin access denied: insufficient role',
      meta: { userId: user.id, role: user.role, path: req.url }
    });
    const err = new Error('Forbidden: admin only');
    (err as any).statusCode = 403;
    throw err;
  }
  await logger.info({
    source: 'auth',
    action: 'requireAdmin',
    message: 'Admin access granted',
    meta: { userId: user.id, path: req.url }
  });
  return user;
};

export const authenticateUser = async ({ email, password }: { email: string; password: string }) => {
  await ensureSchema();
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { email } });
  if (!user || !user.passwordHash) {
    await logger.warn({
      source: 'auth',
      action: 'authenticateUser',
      message: 'Login failed: user not found',
      meta: { email }
    });
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await logger.warn({
      source: 'auth',
      action: 'authenticateUser',
      message: 'Login failed: invalid credentials',
      meta: { email, userId: user.id }
    });
    return null;
  }
  await logger.info({
    source: 'auth',
    action: 'authenticateUser',
    message: 'Login successful',
    meta: { userId: user.id, email }
  });
  return toAuthUser(user);
};

export const createLoginSession = async (userId: number) => {
  await ensureSchema();
  const token = crypto.randomBytes(24).toString('hex');
  const sessionRepo = AppDataSource.getRepository(LoginSession);
  const session = sessionRepo.create({ userId, token });
  await sessionRepo.save(session);
  await redis.set(`session:${token}`, userId, 'EX', 30 * 24 * 60 * 60);
  return token;
};
