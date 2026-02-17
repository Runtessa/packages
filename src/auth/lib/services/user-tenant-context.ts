import { Brackets } from 'typeorm';
import { randomId } from '../crypto';
import { AuthDataSource } from '../db';
import { OrganizationEntity, UserTenantMembershipEntity } from '../typeorm/entities';
import { findWhitelistTenant, normalizeTenantName } from './tenant-whitelist';
import { schemas, upsertVersionedRecord } from './versioning';

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const normalizeOrgRandId = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.length > 64) {
    const error = new Error('tenant_org_id is too long') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const resolveOrganizationSubtree = async (rootOrgRandId: string): Promise<Set<string>> => {
  const organizations = await AuthDataSource.getRepository(OrganizationEntity).find({
    where: { isCurrent: true, isActive: true },
  });

  const children = new Map<string, string[]>();
  organizations.forEach((org) => {
    if (!org.parentOrgRandId) return;
    const list = children.get(org.parentOrgRandId) || [];
    list.push(org.randId);
    children.set(org.parentOrgRandId, list);
  });

  const queue = [rootOrgRandId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const next = children.get(current) || [];
    next.forEach((id) => {
      if (!visited.has(id)) queue.push(id);
    });
  }

  return visited;
};

export const resolveTenantOrgContext = async ({
  tenantName,
  tenantOrgRandId,
}: {
  tenantName?: string | null;
  tenantOrgRandId?: string | null;
}): Promise<{
  tenantName: string | null;
  tenantRandId: string | null;
  effectiveOrgRandId: string | null;
}> => {
  const normalizedTenantName = String(tenantName || '').trim()
    ? normalizeTenantName(String(tenantName))
    : null;
  const normalizedOrgRandId = normalizeOrgRandId(tenantOrgRandId);

  if (!normalizedTenantName) {
    return {
      tenantName: null,
      tenantRandId: null,
      effectiveOrgRandId: normalizedOrgRandId,
    };
  }

  const whitelist = await findWhitelistTenant(normalizedTenantName);
  if (!whitelist || !whitelist.isActive) {
    const error = new Error('Tenant is not whitelisted for SSO') as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }

  const meta = asObject(whitelist.meta);
  const rootOrgRandId = normalizeOrgRandId(meta.organizationRandId);

  if (!rootOrgRandId) {
    return {
      tenantName: normalizedTenantName,
      tenantRandId: whitelist.tenantRandId || null,
      effectiveOrgRandId: normalizedOrgRandId,
    };
  }

  const allowedOrgIds = await resolveOrganizationSubtree(rootOrgRandId);
  const candidateOrgRandId = normalizedOrgRandId || rootOrgRandId;
  if (candidateOrgRandId && !allowedOrgIds.has(candidateOrgRandId)) {
    const error = new Error('tenant_org_id is outside tenant organization scope') as Error & {
      statusCode?: number;
    };
    error.statusCode = 403;
    throw error;
  }

  return {
    tenantName: normalizedTenantName,
    tenantRandId: whitelist.tenantRandId || null,
    effectiveOrgRandId: candidateOrgRandId,
  };
};

export const upsertUserTenantMembership = async ({
  userRandId,
  tenantName,
  tenantRandId,
  orgRandId,
  source,
  actorUserRandId,
  actorTenantRandId,
}: {
  userRandId: string;
  tenantName: string;
  tenantRandId?: string | null;
  orgRandId?: string | null;
  source: 'signup' | 'login' | 'tenant-sync';
  actorUserRandId: string;
  actorTenantRandId?: string | null;
}): Promise<UserTenantMembershipEntity> => {
  const repo = AuthDataSource.getRepository(UserTenantMembershipEntity);
  const existing = await repo
    .createQueryBuilder('membership')
    .where('membership.user_rand_id = :userRandId', { userRandId })
    .andWhere('membership.tenant_name = :tenantName', { tenantName })
    .andWhere('membership.is_current = true')
    .andWhere(
      new Brackets((qb) => {
        if (orgRandId) {
          qb.where('membership.org_rand_id = :orgRandId', { orgRandId });
        } else {
          qb.where('membership.org_rand_id IS NULL');
        }
      }),
    )
    .getOne();

  const effectiveRandId = existing?.randId || randomId(16);
  const updated = await upsertVersionedRecord(
    schemas.user_tenant_memberships,
    effectiveRandId,
    {
      userRandId,
      tenantName,
      tenantRandId: tenantRandId || null,
      orgRandId: orgRandId || null,
      source,
      isActive: true,
      meta: existing?.meta || {},
    },
    {
      actorUserRandId,
      actorTenantRandId: actorTenantRandId || null,
      changeReason: existing ? 'tenant-membership-updated' : 'tenant-membership-created',
    },
  );

  return updated as unknown as UserTenantMembershipEntity;
};

