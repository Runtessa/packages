import { In } from 'typeorm';
import { randomId } from '../crypto';
import { AuthDataSource } from '../db';
import {
  OrganizationEntity,
  RoleEntity,
  TenantWhitelistEntity,
  UserEntity,
  UserOrganizationEntity,
  UserRoleEntity,
  UserTenantMembershipEntity,
} from '../typeorm/entities';
import { findWhitelistTenant, listWhitelist, normalizeTenantName } from './tenant-whitelist';
import { findCurrentUserByRandId, schemas, upsertVersionedRecord } from './versioning';

const ROLE_CODE_PATTERN = /^[a-z0-9]+(?::[a-z0-9._-]+)+$/i;

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const normalizeText = (value: unknown, label: string, max: number): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    const error = new Error(`${label} is required`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  if (normalized.length > max) {
    const error = new Error(`${label} is too long`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const normalizeRoleCode = (value: unknown): string => {
  const normalized = normalizeText(value, 'role_code', 96).toLowerCase();
  if (!ROLE_CODE_PATTERN.test(normalized)) {
    const error = new Error('role_code must be nominal and colon-separated (example: sales:manager)') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

const toBool = (value: unknown, fallback = true): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const readTenantOrganizationRandId = (row: TenantWhitelistEntity): string | null => {
  const meta = asObject(row.meta);
  const orgRandId = typeof meta.organizationRandId === 'string' ? meta.organizationRandId.trim() : '';
  return orgRandId || null;
};

const ensureOrganizationExists = async (orgRandId: string): Promise<OrganizationEntity> => {
  const repo = AuthDataSource.getRepository(OrganizationEntity);
  const row = await repo.findOne({ where: { randId: orgRandId, isCurrent: true } });
  if (!row) {
    const error = new Error('Organization not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return row;
};

const ensureRoleExists = async (roleRandId: string): Promise<RoleEntity> => {
  const repo = AuthDataSource.getRepository(RoleEntity);
  const row = await repo.findOne({ where: { randId: roleRandId, isCurrent: true } });
  if (!row) {
    const error = new Error('Role not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return row;
};

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
    new Set(
      rows
        .map((row) => readTenantOrganizationRandId(row))
        .filter((value): value is string => Boolean(value)),
    ),
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

export const assignUserOrganization = async ({
  userRandId,
  orgRandId,
  isAssignmentActive,
  actorUserRandId,
}: {
  userRandId: string;
  orgRandId: string;
  isAssignmentActive?: boolean;
  actorUserRandId: string;
}) => {
  const normalizedUserRandId = normalizeText(userRandId, 'user_rand_id', 64);
  const normalizedOrgRandId = normalizeText(orgRandId, 'org_rand_id', 64);

  const user = await findCurrentUserByRandId(normalizedUserRandId);
  if (!user) {
    const error = new Error('User not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  await ensureOrganizationExists(normalizedOrgRandId);

  const repo = AuthDataSource.getRepository(UserOrganizationEntity);
  const existing = await repo.findOne({
    where: {
      userRandId: normalizedUserRandId,
      orgRandId: normalizedOrgRandId,
      isCurrent: true,
    },
  });

  const effectiveRandId = existing?.randId || randomId(16);
  const updated = await upsertVersionedRecord(
    schemas.user_orgs,
    effectiveRandId,
    {
      userRandId: normalizedUserRandId,
      orgRandId: normalizedOrgRandId,
      isAssignmentActive: toBool(isAssignmentActive, true),
      meta: existing?.meta || {},
    },
    {
      actorUserRandId,
      changeReason: existing ? 'admin-user-org-assignment-updated' : 'admin-user-org-assigned',
    },
  );

  return {
    randId: updated.randId,
    userRandId: updated.userRandId,
    orgRandId: updated.orgRandId,
    isAssignmentActive: updated.isAssignmentActive,
    changedAt: updated.changedAt,
  };
};

export const assignUserRole = async ({
  userRandId,
  roleRandId,
  orgRandId,
  isAssignmentActive,
  actorUserRandId,
}: {
  userRandId: string;
  roleRandId: string;
  orgRandId: string;
  isAssignmentActive?: boolean;
  actorUserRandId: string;
}) => {
  const normalizedUserRandId = normalizeText(userRandId, 'user_rand_id', 64);
  const normalizedRoleRandId = normalizeText(roleRandId, 'role_rand_id', 64);
  const normalizedOrgRandId = normalizeText(orgRandId, 'org_rand_id', 64);

  const user = await findCurrentUserByRandId(normalizedUserRandId);
  if (!user) {
    const error = new Error('User not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const role = await ensureRoleExists(normalizedRoleRandId);
  if (role.orgRandId !== normalizedOrgRandId) {
    const error = new Error('Role organization mismatch') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }

  const repo = AuthDataSource.getRepository(UserRoleEntity);
  const existing = await repo.findOne({
    where: {
      userRandId: normalizedUserRandId,
      roleRandId: normalizedRoleRandId,
      orgRandId: normalizedOrgRandId,
      isCurrent: true,
    },
  });

  const effectiveRandId = existing?.randId || randomId(16);
  const updated = await upsertVersionedRecord(
    schemas.user_roles,
    effectiveRandId,
    {
      userRandId: normalizedUserRandId,
      roleRandId: normalizedRoleRandId,
      orgRandId: normalizedOrgRandId,
      isAssignmentActive: toBool(isAssignmentActive, true),
      meta: existing?.meta || {},
    },
    {
      actorUserRandId,
      changeReason: existing ? 'admin-user-role-assignment-updated' : 'admin-user-role-assigned',
    },
  );

  return {
    randId: updated.randId,
    userRandId: updated.userRandId,
    roleRandId: updated.roleRandId,
    orgRandId: updated.orgRandId,
    isAssignmentActive: updated.isAssignmentActive,
    changedAt: updated.changedAt,
  };
};

const normalizePage = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const listUsersWithAssignments = async ({
  page,
  limit,
  search,
  tenantName,
  tenantOrgRandId,
}: {
  page?: number;
  limit?: number;
  search?: string;
  tenantName?: string;
  tenantOrgRandId?: string;
}) => {
  const resolvedPage = normalizePage(page, 1);
  const resolvedLimit = Math.min(100, normalizePage(limit, 20));
  const normalizedSearch = String(search || '').trim();
  const normalizedTenantName = String(tenantName || '').trim()
    ? normalizeTenantName(String(tenantName))
    : '';
  const normalizedTenantOrgRandId = String(tenantOrgRandId || '').trim();

  const userRepo = AuthDataSource.getRepository(UserEntity);
  const userQb = userRepo
    .createQueryBuilder('user')
    .where('user.is_current = true')
    .orderBy('user.changed_at', 'DESC');

  if (normalizedSearch) {
    userQb.andWhere(
      'user.email ILIKE :term OR user.phone_number ILIKE :term OR user.first_name ILIKE :term OR user.last_name ILIKE :term OR user.rand_id ILIKE :term',
      { term: `%${normalizedSearch}%` },
    );
  }

  if (normalizedTenantName) {
    userQb.andWhere(
      `EXISTS (
        SELECT 1
          FROM user_tenant_memberships utm
         WHERE utm.user_rand_id = user.rand_id
           AND utm.is_current = true
           AND utm.is_active = true
           AND utm.tenant_name = :tenantName
           ${normalizedTenantOrgRandId ? 'AND utm.org_rand_id = :tenantOrgRandId' : ''}
      )`,
      normalizedTenantOrgRandId
        ? { tenantName: normalizedTenantName, tenantOrgRandId: normalizedTenantOrgRandId }
        : { tenantName: normalizedTenantName },
    );
  }

  const [users, total] = await userQb
    .skip((resolvedPage - 1) * resolvedLimit)
    .take(resolvedLimit)
    .getManyAndCount();

  const userIds = users.map((user) => user.randId);
  if (!userIds.length) {
    return {
      page: resolvedPage,
      limit: resolvedLimit,
      total,
      items: [] as Array<Record<string, unknown>>,
    };
  }

  const [orgAssignments, roleAssignments, organizations, roles, tenantMemberships] = await Promise.all([
    AuthDataSource.getRepository(UserOrganizationEntity).find({
      where: {
        userRandId: In(userIds),
        isCurrent: true,
      },
      order: { changedAt: 'DESC' },
    }),
    AuthDataSource.getRepository(UserRoleEntity).find({
      where: {
        userRandId: In(userIds),
        isCurrent: true,
      },
      order: { changedAt: 'DESC' },
    }),
    AuthDataSource.getRepository(OrganizationEntity).find({
      where: { isCurrent: true },
    }),
    AuthDataSource.getRepository(RoleEntity).find({
      where: { isCurrent: true },
    }),
    AuthDataSource.getRepository(UserTenantMembershipEntity).find({
      where: {
        userRandId: In(userIds),
        isCurrent: true,
        isActive: true,
        ...(normalizedTenantName ? { tenantName: normalizedTenantName } : {}),
        ...(normalizedTenantOrgRandId ? { orgRandId: normalizedTenantOrgRandId } : {}),
      },
      order: { changedAt: 'DESC' },
    }),
  ]);

  const orgMap = new Map(organizations.map((org) => [org.randId, org]));
  const roleMap = new Map(roles.map((role) => [role.randId, role]));

  const orgAssignmentsByUser = new Map<string, UserOrganizationEntity[]>();
  orgAssignments.forEach((assignment) => {
    const list = orgAssignmentsByUser.get(assignment.userRandId) || [];
    list.push(assignment);
    orgAssignmentsByUser.set(assignment.userRandId, list);
  });

  const roleAssignmentsByUser = new Map<string, UserRoleEntity[]>();
  roleAssignments.forEach((assignment) => {
    const list = roleAssignmentsByUser.get(assignment.userRandId) || [];
    list.push(assignment);
    roleAssignmentsByUser.set(assignment.userRandId, list);
  });

  const tenantMembershipsByUser = new Map<string, UserTenantMembershipEntity[]>();
  tenantMemberships.forEach((membership) => {
    const list = tenantMembershipsByUser.get(membership.userRandId) || [];
    list.push(membership);
    tenantMembershipsByUser.set(membership.userRandId, list);
  });

  const items = users.map((user) => {
    const meta = asObject(user.meta);
    const organizationsForUser = (orgAssignmentsByUser.get(user.randId) || []).map((assignment) => {
      const org = orgMap.get(assignment.orgRandId);
      return {
        assignmentRandId: assignment.randId,
        orgRandId: assignment.orgRandId,
        orgName: org?.name || assignment.orgRandId,
        orgCode: org?.code || null,
        isAssignmentActive: assignment.isAssignmentActive,
      };
    });

    const rolesForUser = (roleAssignmentsByUser.get(user.randId) || []).map((assignment) => {
      const role = roleMap.get(assignment.roleRandId);
      const org = orgMap.get(assignment.orgRandId);
      return {
        assignmentRandId: assignment.randId,
        roleRandId: assignment.roleRandId,
        roleName: role?.roleName || assignment.roleRandId,
        roleCode: role?.roleCode || null,
        orgRandId: assignment.orgRandId,
        orgName: org?.name || null,
        isAssignmentActive: assignment.isAssignmentActive,
      };
    });

    const signupContexts = (tenantMembershipsByUser.get(user.randId) || []).map((membership) => ({
      tenantName: membership.tenantName,
      tenantRandId: membership.tenantRandId,
      orgRandId: membership.orgRandId,
      source: membership.source,
      changedAt: membership.changedAt,
    }));

    return {
      randId: user.randId,
      email: user.email,
      phoneNumber: user.phoneNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      isAuthAdmin: meta.authAdmin === true,
      organizations: organizationsForUser,
      roles: rolesForUser,
      signupContexts,
      changedAt: user.changedAt,
    };
  });

  return {
    page: resolvedPage,
    limit: resolvedLimit,
    total,
    items,
  };
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
