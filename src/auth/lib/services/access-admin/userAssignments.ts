import { In } from 'typeorm';
import { randomId } from '../../crypto';
import { AuthDataSource } from '../../db';
import {
  OrganizationEntity,
  RoleEntity,
  UserEntity,
  UserOrganizationEntity,
  UserRoleEntity,
  UserTenantMembershipEntity,
} from '../../typeorm/entities';
import { findCurrentUserByRandId, schemas, upsertVersionedRecord } from '../versioning';
import { normalizeTenantName } from '../tenant-whitelist';
import { asObject, normalizePage, normalizeText, toBool } from './utils';
import { ensureOrganizationExists, ensureRoleExists } from './lookups';

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
    AuthDataSource.getRepository(OrganizationEntity).find({ where: { isCurrent: true } }),
    AuthDataSource.getRepository(RoleEntity).find({ where: { isCurrent: true } }),
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
