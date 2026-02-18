import { In } from 'typeorm';
import { randomId } from '../../crypto';
import { AuthDataSource } from '../../db';
import {
  OrganizationEntity,
  RoleEntity,
  TenantWhitelistEntity,
} from '../../typeorm/entities';
import { findWhitelistTenant, listWhitelist, normalizeTenantName } from '../tenant-whitelist';
import { schemas, upsertVersionedRecord } from '../versioning';
import { asObject, normalizeRoleCode, normalizeText, toBool } from './utils';
import { ensureOrganizationExists, readTenantOrganizationRandId } from './lookups';

export const listOrganizations = async () => {
  const rows = await AuthDataSource.getRepository(OrganizationEntity).find({
    where: { isCurrent: true },
    order: { name: 'ASC' },
  });

  return rows.map((row) => ({
    randId: row.randId,
    name: row.name,
    code: row.code,
    parentOrgRandId: row.parentOrgRandId,
    isActive: row.isActive,
    changedAt: row.changedAt,
  }));
};

export const listRoles = async () => {
  const [roles, organizations] = await Promise.all([
    AuthDataSource.getRepository(RoleEntity).find({
      where: { isCurrent: true },
      order: { roleCode: 'ASC' },
    }),
    AuthDataSource.getRepository(OrganizationEntity).find({
      where: { isCurrent: true },
      order: { name: 'ASC' },
    }),
  ]);

  const orgMap = new Map(organizations.map((org) => [org.randId, org]));

  return roles.map((role) => ({
    randId: role.randId,
    roleName: role.roleName,
    roleCode: role.roleCode,
    orgRandId: role.orgRandId,
    orgName: orgMap.get(role.orgRandId)?.name || null,
    isActive: role.isActive,
    changedAt: role.changedAt,
  }));
};

export const listTenantOrganizationMappings = async () => {
  const rows = await listWhitelist();
  const orgIds = Array.from(
    new Set(rows.map((row) => readTenantOrganizationRandId(row)).filter((value): value is string => Boolean(value))),
  );

  const organizations = orgIds.length
    ? await AuthDataSource.getRepository(OrganizationEntity).find({
        where: { randId: In(orgIds), isCurrent: true },
      })
    : [];
  const orgMap = new Map(organizations.map((org) => [org.randId, org]));

  return rows.map((row) => {
    const organizationRandId = readTenantOrganizationRandId(row);
    const organization = organizationRandId ? orgMap.get(organizationRandId) : null;
    const meta = asObject(row.meta);
    return {
      tenantName: row.tenantName,
      tenantRandId: row.tenantRandId,
      isActive: row.isActive,
      allowRegistration: typeof meta.allowRegistration === 'boolean' ? meta.allowRegistration : true,
      organizationRandId,
      organizationName: organization?.name || null,
      organizationCode: organization?.code || null,
      updatedAt: row.updatedAt,
    };
  });
};

export const assignTenantOrganization = async ({
  tenantName,
  organizationRandId,
}: {
  tenantName: string;
  organizationRandId: string | null;
}) => {
  const normalizedTenantName = normalizeTenantName(tenantName);
  const row = await findWhitelistTenant(normalizedTenantName);
  if (!row) {
    const error = new Error('Tenant whitelist entry not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  let organization: OrganizationEntity | null = null;
  if (organizationRandId) {
    organization = await ensureOrganizationExists(organizationRandId);
  }

  const repo = AuthDataSource.getRepository(TenantWhitelistEntity);
  const meta = asObject(row.meta);
  const nextMeta: Record<string, unknown> = { ...meta };
  if (organization) {
    nextMeta.organizationRandId = organization.randId;
    nextMeta.organizationCode = organization.code;
    nextMeta.organizationName = organization.name;
  } else {
    delete nextMeta.organizationRandId;
    delete nextMeta.organizationCode;
    delete nextMeta.organizationName;
  }

  row.meta = nextMeta;
  await repo.save(row);

  return {
    tenantName: row.tenantName,
    tenantRandId: row.tenantRandId,
    organizationRandId: organization?.randId || null,
    organizationName: organization?.name || null,
    organizationCode: organization?.code || null,
    updatedAt: row.updatedAt,
  };
};

export const upsertOrganization = async ({
  randId,
  name,
  code,
  parentOrgRandId,
  isActive,
  actorUserRandId,
}: {
  randId?: string;
  name: string;
  code: string;
  parentOrgRandId?: string | null;
  isActive?: boolean;
  actorUserRandId: string;
}) => {
  const normalizedName = normalizeText(name, 'name', 180);
  const normalizedCode = normalizeText(code, 'code', 96).toLowerCase();
  const normalizedParent = parentOrgRandId ? String(parentOrgRandId).trim() : null;
  const effectiveRandId = (randId && String(randId).trim()) || randomId(16);

  if (normalizedParent) {
    if (normalizedParent === effectiveRandId) {
      const error = new Error('Organization cannot be parent of itself') as Error & { statusCode?: number };
      error.statusCode = 400;
      throw error;
    }
    await ensureOrganizationExists(normalizedParent);
  }

  const existing = await AuthDataSource.getRepository(OrganizationEntity).findOne({
    where: { randId: effectiveRandId, isCurrent: true },
  });

  const updated = await upsertVersionedRecord(
    schemas.organizations,
    effectiveRandId,
    {
      name: normalizedName,
      code: normalizedCode,
      parentOrgRandId: normalizedParent,
      isActive: toBool(isActive, true),
      meta: existing?.meta || {},
    },
    {
      actorUserRandId,
      changeReason: existing ? 'admin-org-updated' : 'admin-org-created',
    },
  );

  return {
    randId: updated.randId,
    name: updated.name,
    code: updated.code,
    parentOrgRandId: updated.parentOrgRandId,
    isActive: updated.isActive,
    changedAt: updated.changedAt,
  };
};

export const upsertRole = async ({
  randId,
  roleName,
  roleCode,
  orgRandId,
  isActive,
  actorUserRandId,
}: {
  randId?: string;
  roleName: string;
  roleCode: string;
  orgRandId: string;
  isActive?: boolean;
  actorUserRandId: string;
}) => {
  const normalizedRoleName = normalizeText(roleName, 'role_name', 160);
  const normalizedRoleCode = normalizeRoleCode(roleCode);
  const normalizedOrgRandId = normalizeText(orgRandId, 'org_rand_id', 64);
  const effectiveRandId = (randId && String(randId).trim()) || randomId(16);

  await ensureOrganizationExists(normalizedOrgRandId);

  const existing = await AuthDataSource.getRepository(RoleEntity).findOne({
    where: { randId: effectiveRandId, isCurrent: true },
  });

  const updated = await upsertVersionedRecord(
    schemas.roles,
    effectiveRandId,
    {
      roleName: normalizedRoleName,
      roleCode: normalizedRoleCode,
      orgRandId: normalizedOrgRandId,
      isActive: toBool(isActive, true),
      meta: existing?.meta || {},
    },
    {
      actorUserRandId,
      changeReason: existing ? 'admin-role-updated' : 'admin-role-created',
    },
  );

  return {
    randId: updated.randId,
    roleName: updated.roleName,
    roleCode: updated.roleCode,
    orgRandId: updated.orgRandId,
    isActive: updated.isActive,
    changedAt: updated.changedAt,
  };
};

export const resolveOrganizationSubtree = async (rootOrgRandId: string): Promise<Set<string>> => {
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
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const childIds = children.get(current) || [];
    childIds.forEach((child) => {
      if (!visited.has(child)) queue.push(child);
    });
  }

  return visited;
};

export const resolveTenantOrganizationScope = async (tenantName: string): Promise<{
  rootOrgRandId: string | null;
  orgIds: Set<string>;
}> => {
  if (!String(tenantName || '').trim()) {
    return { rootOrgRandId: null, orgIds: new Set() };
  }
  const row = await findWhitelistTenant(tenantName);
  const rootOrgRandId = row ? readTenantOrganizationRandId(row) : null;
  if (!rootOrgRandId) {
    return { rootOrgRandId: null, orgIds: new Set() };
  }

  const orgIds = await resolveOrganizationSubtree(rootOrgRandId);
  return {
    rootOrgRandId,
    orgIds,
  };
};
