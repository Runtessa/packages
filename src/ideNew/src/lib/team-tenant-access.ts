import { TeamTenant } from '@idp/shared';
import { AppDataSource, ensureSchema } from './db';
import { type IdePermission } from './rbac';

type ScopedUser = {
  isAdmin?: boolean;
  role?: string;
  normalizedRole?: string;
  activeTeamId?: number | null;
  permissions?: IdePermission[];
};

const forbidden = (message: string) => {
  const err = new Error(message);
  (err as any).statusCode = 403;
  return err;
};

export const getTenantIdsForTeam = async (teamId: number) => {
  await ensureSchema();
  const repo = AppDataSource.getRepository(TeamTenant);
  const rows = await repo.find({
    where: { teamId },
    order: { tenantId: 'ASC' },
  });
  return rows.map((entry) => entry.tenantId);
};

export const getTenantScopeForUser = async (user: ScopedUser): Promise<string[] | null> => {
  if (user?.isAdmin) return null;
  const teamId = Number(user?.activeTeamId || 0);
  if (!Number.isInteger(teamId) || teamId <= 0) return [];
  return getTenantIdsForTeam(teamId);
};

const hasPermission = (user: ScopedUser, permission: IdePermission) => {
  if (user?.isAdmin) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
};

export const canWriteTenantForUser = (user: ScopedUser) => {
  return hasPermission(user, 'ide.tenants.manage');
};

export const assertTenantReadableForUser = async (user: ScopedUser, tenantId: string) => {
  const scope = await getTenantScopeForUser(user);
  if (scope === null) return;
  if (scope.includes(tenantId)) return;
  throw forbidden('Forbidden: tenant is outside active team scope');
};

export const assertTenantWritableForUser = async (user: ScopedUser, tenantId: string) => {
  if (!canWriteTenantForUser(user)) {
    throw forbidden('Forbidden: tenant write requires tenant_admin role');
  }
  await assertTenantReadableForUser(user, tenantId);
};
