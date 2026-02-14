import crypto from 'crypto';
import { NextApiRequest } from 'next';
import { AppDataSource, ensureSchema } from './db';
import { verifyPassword } from './password';
import redis from './redis';
import { logger } from './logger';
import { User } from '@idp/shared';
import { LoginSession } from '@idp/shared';
import { TeamMember } from '@idp/shared';
import { type IdePermission, getRolePermissions, normalizeIdeRole } from './rbac';
import {
  normalizeTeamMemberRoles,
  pickPrimaryTeamMemberRole,
} from './team-roles';

type AuthHeader = {
  sessionToken?: string;
  apiToken?: string;
};

type AuthUser = {
  id: number;
  email: string;
  baseRole: string;
  teamRole: string;
  teamRoles: string[];
  role: string;
  normalizedRole: string;
  permissions: IdePermission[];
  teams: Array<{
    teamId: number;
    teamKey: string;
    teamName: string;
    role: string;
    roles: string[];
  }>;
  activeTeamId: number | null;
  activeTeamKey: string | null;
  activeTeamName: string | null;
  token?: string | null;
  isAdmin: boolean;
};

type TeamMembershipInfo = {
  teamId: number;
  teamKey: string;
  teamName: string;
  role: string;
  roles: string[];
};

const SESSION_USER_TTL_SECONDS = 30 * 24 * 60 * 60;
const buildSessionUserKey = (token: string) => `session:${token}`;
const buildSessionTeamKey = (token: string) => `session:team:${token}`;
const isTeamlessPrivilegedRole = (roleInput: unknown) => {
  const normalized = normalizeIdeRole(roleInput);
  return normalized === 'admin' || normalized === 'platform_admin';
};

const parsePathname = (req: NextApiRequest) => {
  const raw = String(req.url || '').trim();
  const withoutQuery = raw.split('?')[0] || '';
  return withoutQuery || '/';
};

const resolveRoutePermission = (req: NextApiRequest): IdePermission | null => {
  const pathname = parsePathname(req);
  const method = String(req.method || 'GET').toUpperCase();
  const isWriteMethod = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  if (pathname === '/api/users') {
    return isWriteMethod ? 'ide.users.manage' : 'ide.users.read';
  }
  if (pathname.startsWith('/api/admin/teams')) {
    return isWriteMethod ? 'ide.users.manage' : 'ide.users.read';
  }
  if (pathname.startsWith('/api/admin/tenants')) {
    return isWriteMethod ? 'ide.tenants.manage' : 'ide.tenants.read';
  }
  if (pathname.startsWith('/api/admin/shared-packages')) {
    return isWriteMethod ? 'ide.shared_ui.write' : 'ide.shared_ui.read';
  }
  if (pathname.startsWith('/api/admin/shared-modules')) {
    return isWriteMethod ? 'ide.shared_modules.write' : 'ide.shared_modules.read';
  }
  if (pathname.startsWith('/api/admin/monitoring')) {
    return isWriteMethod ? 'ide.monitoring.manage' : 'ide.monitoring.read';
  }
  if (pathname.startsWith('/api/admin/containers')) {
    return isWriteMethod ? 'ide.containers.manage' : 'ide.containers.read';
  }
  if (pathname.startsWith('/api/admin/logs')) {
    return 'ide.logs.read';
  }
  if (pathname.startsWith('/api/admin/settings')) {
    return 'ide.settings.manage';
  }
  return null;
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

const parsePreferredTeamId = (req: NextApiRequest) => {
  const raw = req.headers['x-idp-team-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const buildPermissionsForRoles = (rolesInput: unknown): IdePermission[] => {
  const roles = normalizeTeamMemberRoles(rolesInput);
  const permissions = new Set<IdePermission>();
  roles.forEach((role) => {
    getRolePermissions(role).forEach((permission) => permissions.add(permission));
  });
  return Array.from(permissions);
};

const mapMemberships = async (userId: number): Promise<TeamMembershipInfo[]> => {
  await ensureSchema();
  const memberRepo = AppDataSource.getRepository(TeamMember);
  const rows = await memberRepo
    .createQueryBuilder('member')
    .innerJoinAndSelect('member.team', 'team')
    .where('member.userId = :userId', { userId })
    .andWhere('team.isActive = true')
    .orderBy('team.name', 'ASC')
    .getMany();

  return rows.map((row) => ({
    roles: normalizeTeamMemberRoles(row.roles ?? row.role ?? 'observer'),
    role: pickPrimaryTeamMemberRole(row.roles ?? row.role ?? 'observer'),
    teamId: row.teamId,
    teamKey: row.team?.key || '',
    teamName: row.team?.name || `Team ${row.teamId}`,
  }));
};

const pickActiveMembership = (
  memberships: TeamMembershipInfo[],
  preferredTeamId?: number | null
) => {
  if (!memberships.length) return null;
  if (preferredTeamId) {
    const matched = memberships.find((entry) => entry.teamId === preferredTeamId);
    if (matched) return matched;
  }
  return memberships[0] || null;
};

const toAuthUser = (
  user: User,
  token?: string | null,
  options?: {
    teams?: TeamMembershipInfo[];
    preferredTeamId?: number | null;
  }
): AuthUser => {
  const teams = options?.teams ?? [];
  const activeMembership = pickActiveMembership(teams, options?.preferredTeamId);
  const activeTeamRoles = activeMembership?.roles || [];
  const effectiveRole = isTeamlessPrivilegedRole(user.role)
    ? String(user.role || 'platform_admin')
    : String(activeMembership?.role || user.role || 'user');
  const normalizedRole = normalizeIdeRole(effectiveRole);
  const permissions = isTeamlessPrivilegedRole(user.role)
    ? getRolePermissions(normalizedRole)
    : buildPermissionsForRoles(activeTeamRoles);
  return {
    id: user.id,
    email: user.email,
    baseRole: String(user.role || 'user'),
    teamRole: String(activeMembership?.role || 'observer'),
    teamRoles: activeTeamRoles,
    role: normalizedRole,
    normalizedRole,
    permissions,
    teams,
    activeTeamId: activeMembership?.teamId ?? null,
    activeTeamKey: activeMembership?.teamKey ?? null,
    activeTeamName: activeMembership?.teamName ?? null,
    token: token ?? null,
    isAdmin: normalizedRole === 'admin' || normalizedRole === 'platform_admin',
  };
};

export const getSessionTokenFromRequest = (req: NextApiRequest) => {
  const { sessionToken } = parseAuthHeader(req);
  return sessionToken || getSessionTokenFromCookie(req) || null;
};

const ensureUserHasActiveTeamMemberships = async (user: User) => {
  const memberships = await mapMemberships(user.id);
  if (!memberships.length) {
    if (isTeamlessPrivilegedRole(user.role)) {
      return memberships;
    }
    const err = new Error('No active team membership assigned');
    (err as any).statusCode = 403;
    throw err;
  }
  return memberships;
};

export const getUserTeamMemberships = async (userId: number) => {
  await ensureSchema();
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found');
    (err as any).statusCode = 404;
    throw err;
  }
  return ensureUserHasActiveTeamMemberships(user);
};

const getUserByApiToken = async (token: string, preferredTeamId?: number | null) => {
  await ensureSchema();
  const repo = AppDataSource.getRepository(User);
  const user = await repo.findOne({ where: { token } });
  if (!user) return null;
  const teams = await ensureUserHasActiveTeamMemberships(user);
  return toAuthUser(user, token, { teams, preferredTeamId });
};

const getUserBySessionToken = async (token: string) => {
  await ensureSchema();
  const cached = await redis.get(buildSessionUserKey(token));
  let userId: number | null = null;

  if (cached) {
    userId = parseInt(cached, 10);
  } else {
    const sessionRepo = AppDataSource.getRepository(LoginSession);
    const session = await sessionRepo.findOne({ where: { token } });
    if (session) {
      userId = session.userId;
      await redis.set(buildSessionUserKey(token), userId, 'EX', SESSION_USER_TTL_SECONDS);
    }
  }

  if (!userId) return null;
  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) return null;
  const teams = await ensureUserHasActiveTeamMemberships(user);
  const selectedTeamRaw = await redis.get(buildSessionTeamKey(token));
  const selectedTeamId = selectedTeamRaw ? Number(selectedTeamRaw) : null;
  const activeMembership = pickActiveMembership(teams, selectedTeamId);
  if (teams.length) {
    if (activeMembership && activeMembership.teamId !== selectedTeamId) {
      await redis.set(
        buildSessionTeamKey(token),
        String(activeMembership.teamId),
        'EX',
        SESSION_USER_TTL_SECONDS
      );
    }
  } else {
    await redis.del(buildSessionTeamKey(token));
  }
  return toAuthUser(user, token, {
    teams,
    preferredTeamId: activeMembership?.teamId ?? null,
  });
};

export const requireUser = async (req: NextApiRequest): Promise<AuthUser> => {
  const { sessionToken, apiToken } = parseAuthHeader(req);
  const cookieToken = getSessionTokenFromCookie(req);
  const preferredTeamId = parsePreferredTeamId(req);
  let user: AuthUser | null = null;

  if (sessionToken) user = await getUserBySessionToken(sessionToken);
  else if (cookieToken) user = await getUserBySessionToken(cookieToken);

  if (!user && apiToken) {
    user = await getUserByApiToken(apiToken, preferredTeamId);
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
  const requiredPermission = resolveRoutePermission(req);
  const allowedByPermission = requiredPermission ? user.permissions.includes(requiredPermission) : false;
  if (!user.isAdmin && !allowedByPermission) {
    await logger.warn({
      source: 'auth',
      action: 'requireAdmin',
      message: 'Access denied: insufficient permissions',
      meta: {
        userId: user.id,
        role: user.role,
        normalizedRole: user.normalizedRole,
        path: req.url,
        requiredPermission,
      }
    });
    const err = new Error(
      requiredPermission
        ? `Forbidden: missing permission ${requiredPermission}`
        : 'Forbidden: admin only'
    );
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
  const teams = await mapMemberships(user.id);
  return toAuthUser(user, null, { teams, preferredTeamId: teams[0]?.teamId ?? null });
};

export const createLoginSession = async (userId: number, preferredTeamId?: number | null) => {
  await ensureSchema();
  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found');
    (err as any).statusCode = 404;
    throw err;
  }
  const teams = await ensureUserHasActiveTeamMemberships(user);
  const active = pickActiveMembership(teams, preferredTeamId);
  const token = crypto.randomBytes(24).toString('hex');
  const sessionRepo = AppDataSource.getRepository(LoginSession);
  const session = sessionRepo.create({ userId, token });
  await sessionRepo.save(session);
  await redis.set(buildSessionUserKey(token), userId, 'EX', SESSION_USER_TTL_SECONDS);
  if (active) {
    await redis.set(buildSessionTeamKey(token), String(active.teamId), 'EX', SESSION_USER_TTL_SECONDS);
  } else {
    await redis.del(buildSessionTeamKey(token));
  }
  return token;
};

export const setActiveTeamForSession = async (
  sessionToken: string,
  userId: number,
  teamId: number
) => {
  await ensureSchema();
  const userRepo = AppDataSource.getRepository(User);
  const user = await userRepo.findOne({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found');
    (err as any).statusCode = 404;
    throw err;
  }
  const memberships = await ensureUserHasActiveTeamMemberships(user);
  if (!memberships.length) {
    const err = new Error('Current user has no team memberships');
    (err as any).statusCode = 400;
    throw err;
  }
  const matched = memberships.find((entry) => entry.teamId === teamId);
  if (!matched) {
    const err = new Error('Team not assigned to current user');
    (err as any).statusCode = 403;
    throw err;
  }
  await redis.set(buildSessionTeamKey(sessionToken), String(teamId), 'EX', SESSION_USER_TTL_SECONDS);
  return matched;
};
