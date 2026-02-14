import { hasIdePermission, type IdePermission } from '@/lib/rbac';

export const toPermissionArray = (value: unknown): IdePermission[] =>
  Array.isArray(value) ? (value.filter((item) => typeof item === 'string') as IdePermission[]) : [];

export const hasPermissionFromUser = (
  user: { role?: unknown; permissions?: unknown } | null | undefined,
  permission: IdePermission
) => {
  if (!user) return false;
  const permissions = toPermissionArray(user.permissions);
  if (permissions.includes(permission)) return true;
  return hasIdePermission(user.role, permission);
};
