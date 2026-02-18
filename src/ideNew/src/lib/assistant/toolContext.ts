import { HttpMethod } from '@idp/shared';
import { Tenant } from '@idp/shared';
import { hasIdePermission, type IdePermission } from '@/lib/rbac';
import type { AssistantChange } from './types';

export type AssistantToolContext = {
  tenant: Tenant;
  userId: number;
  role: string;
  permissions: IdePermission[];
  isAdmin: boolean;
  activeTeamId?: number | null;
  changes: AssistantChange[];
};

export const hasToolPermission = (ctx: AssistantToolContext, permission: IdePermission) => {
  if (ctx.isAdmin) return true;
  if (Array.isArray(ctx.permissions) && ctx.permissions.includes(permission)) return true;
  return hasIdePermission(ctx.role, permission);
};

export const assertToolPermission = (ctx: AssistantToolContext, permission: IdePermission) => {
  if (hasToolPermission(ctx, permission)) return;
  throw new Error(`Forbidden: missing permission ${permission}`);
};

export const normalizeMethod = (raw: unknown): HttpMethod => {
  if (typeof raw !== 'string') throw new Error('method is required');
  const upper = raw.toUpperCase();
  if (!Object.values(HttpMethod).includes(upper as HttpMethod)) {
    throw new Error('Invalid HTTP method');
  }
  return upper as HttpMethod;
};

export const normalizeRoute = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('routePath is required');
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

export const normalizeCode = (raw: unknown, fallback = ''): string => {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'string') throw new Error('code must be a string');
  return raw;
};

export const normalizeUiName = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('name is required');
  return raw.trim();
};

export const normalizeUiVersion = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('version is required');
  return raw.trim();
};

export const normalizeDependencies = (raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('dependencies must be an array');
  return raw.map((item) => String(item));
};

export const normalizeOwnerTeamId = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('ownerTeamId must be a positive integer');
  }
  return value;
};

export const normalizeTeamIdList = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
};

export const toSharedAccessUser = (ctx: AssistantToolContext) => ({
  isAdmin: ctx.isAdmin,
  role: ctx.role,
  normalizedRole: ctx.role,
  permissions: ctx.permissions,
  activeTeamId: ctx.activeTeamId ?? null,
});
