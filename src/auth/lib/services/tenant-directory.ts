import { In } from 'typeorm';
import { AuthDataSource } from '../db';
import {
  OrganizationEntity,
  RoleEntity,
  UserEntity,
  UserOrganizationEntity,
  UserRoleEntity,
  UserTenantMembershipEntity,
} from '../typeorm/entities';
import { findWhitelistTenant, normalizeTenantName } from './tenant-whitelist';
import { resolveTenantOrganizationScope } from './access-admin';

export interface TenantDirectoryOrganization {
  randId: string;
  code: string;
  name: string;
  parentOrgRandId: string | null;
  path: string;
  depth: number;
}

export interface TenantDirectoryRole {
  roleRandId: string;
  roleCode: string;
  roleName: string;
  orgRandId: string;
  orgPath: string | null;
}

export interface TenantDirectoryUser {
  randId: string;
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  organizations: Array<{
    orgRandId: string;
    orgCode: string | null;
    orgName: string | null;
    orgPath: string | null;
  }>;
  roles: TenantDirectoryRole[];
  signupContext: {
    orgRandId: string | null;
    source: string;
    changedAt: string;
  } | null;
}

interface TenantDirectorySnapshot {
  tenantName: string;
  rootOrgRandId: string | null;
  organizations: TenantDirectoryOrganization[];
  users: TenantDirectoryUser[];
  builtAt: string;
}

const DIRECTORY_CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; snapshot: TenantDirectorySnapshot }>();
const inFlight = new Map<string, Promise<TenantDirectorySnapshot>>();

const normalizePath = (value: string): string => {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
};

const buildSubtreeIndex = (
  organizations: TenantDirectoryOrganization[],
): Map<string, Set<string>> => {
  const children = new Map<string, string[]>();
  organizations.forEach((org) => {
    if (!org.parentOrgRandId) return;
    const list = children.get(org.parentOrgRandId) || [];
    list.push(org.randId);
    children.set(org.parentOrgRandId, list);
  });

  const result = new Map<string, Set<string>>();
  organizations.forEach((org) => {
    const visited = new Set<string>();
    const queue = [org.randId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      (children.get(current) || []).forEach((childId) => {
        if (!visited.has(childId)) queue.push(childId);
      });
    }
    result.set(org.randId, visited);
  });
  return result;
};

const buildOrganizationDirectory = (
  organizations: OrganizationEntity[],
  rootOrgRandId: string | null,
): TenantDirectoryOrganization[] => {
  const byId = new Map(organizations.map((org) => [org.randId, org]));
  const children = new Map<string, OrganizationEntity[]>();
  organizations.forEach((org) => {
    if (!org.parentOrgRandId) return;
    if (!byId.has(org.parentOrgRandId)) return;
    const list = children.get(org.parentOrgRandId) || [];
    list.push(org);
    children.set(org.parentOrgRandId, list);
  });
  for (const list of children.values()) {
    list.sort((left, right) => left.code.localeCompare(right.code));
  }

  const roots = rootOrgRandId
    ? organizations.filter((org) => org.randId === rootOrgRandId)
    : organizations.filter((org) => !org.parentOrgRandId || !byId.has(org.parentOrgRandId));
  roots.sort((left, right) => left.code.localeCompare(right.code));

  const pathMemo = new Map<string, string>();
  const resolvePath = (org: OrganizationEntity): string => {
    if (pathMemo.has(org.randId)) return pathMemo.get(org.randId)!;
    const ownSegment = normalizePath(org.code || org.randId) || org.randId.toLowerCase();
    const parent = org.parentOrgRandId ? byId.get(org.parentOrgRandId) : null;
    const path = parent ? `${resolvePath(parent)}/${ownSegment}` : ownSegment;
    pathMemo.set(org.randId, path);
    return path;
  };

  const visited = new Set<string>();
  const out: TenantDirectoryOrganization[] = [];
  const visit = (org: OrganizationEntity, depth: number) => {
    if (visited.has(org.randId)) return;
    visited.add(org.randId);
    out.push({
      randId: org.randId,
      code: org.code,
      name: org.name,
      parentOrgRandId: org.parentOrgRandId,
      path: resolvePath(org),
      depth,
    });
    (children.get(org.randId) || []).forEach((child) => visit(child, depth + 1));
  };
  roots.forEach((root) => visit(root, 0));
  organizations.forEach((org) => {
    if (!visited.has(org.randId)) visit(org, 0);
  });

  return out;
};

const buildTenantDirectorySnapshot = async (tenantName: string): Promise<TenantDirectorySnapshot> => {
  const normalizedTenantName = normalizeTenantName(tenantName);
  const whitelist = await findWhitelistTenant(normalizedTenantName);
  if (!whitelist || !whitelist.isActive) {
    const error = new Error('Tenant is not whitelisted for SSO') as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }

  const scope = await resolveTenantOrganizationScope(normalizedTenantName);
  if (!scope.rootOrgRandId || scope.orgIds.size === 0) {
    return {
      tenantName: normalizedTenantName,
      rootOrgRandId: null,
      organizations: [],
      users: [],
      builtAt: new Date().toISOString(),
    };
  }

  const allowedOrgIds = Array.from(scope.orgIds);
  const [organizationsRaw, tenantMembershipsRaw] = await Promise.all([
    AuthDataSource.getRepository(OrganizationEntity).find({
      where: {
        randId: In(allowedOrgIds),
        isCurrent: true,
        isActive: true,
      },
    }),
    AuthDataSource.getRepository(UserTenantMembershipEntity).find({
      where: {
        tenantName: normalizedTenantName,
        isCurrent: true,
        isActive: true,
      },
      order: { changedAt: 'DESC' },
    }),
  ]);

  const organizations = buildOrganizationDirectory(organizationsRaw, scope.rootOrgRandId);
  const organizationById = new Map(organizations.map((org) => [org.randId, org]));

  const tenantMemberships = tenantMembershipsRaw.filter((membership) => {
    if (!membership.orgRandId) return true;
    return organizationById.has(membership.orgRandId);
  });

  const userIds = Array.from(new Set(tenantMemberships.map((entry) => entry.userRandId)));
  if (!userIds.length) {
    return {
      tenantName: normalizedTenantName,
      rootOrgRandId: scope.rootOrgRandId,
      organizations,
      users: [],
      builtAt: new Date().toISOString(),
    };
  }

  const [usersRaw, userOrgAssignmentsRaw, userRoleAssignmentsRaw] = await Promise.all([
    AuthDataSource.getRepository(UserEntity).find({
      where: {
        randId: In(userIds),
        isCurrent: true,
        isActive: true,
      },
    }),
    AuthDataSource.getRepository(UserOrganizationEntity).find({
      where: {
        userRandId: In(userIds),
        isCurrent: true,
        isAssignmentActive: true,
      },
    }),
    AuthDataSource.getRepository(UserRoleEntity).find({
      where: {
        userRandId: In(userIds),
        isCurrent: true,
        isAssignmentActive: true,
      },
    }),
  ]);

  const users = usersRaw.filter((user) => userIds.includes(user.randId));
  const roleIds = Array.from(new Set(userRoleAssignmentsRaw.map((assignment) => assignment.roleRandId)));
  const roles = roleIds.length
    ? await AuthDataSource.getRepository(RoleEntity).find({
        where: {
          randId: In(roleIds),
          isCurrent: true,
          isActive: true,
        },
      })
    : [];
  const roleById = new Map(roles.map((role) => [role.randId, role]));

  const orgAssignmentsByUser = new Map<string, UserOrganizationEntity[]>();
  userOrgAssignmentsRaw.forEach((assignment) => {
    if (!organizationById.has(assignment.orgRandId)) return;
    const list = orgAssignmentsByUser.get(assignment.userRandId) || [];
    list.push(assignment);
    orgAssignmentsByUser.set(assignment.userRandId, list);
  });

  const roleAssignmentsByUser = new Map<string, UserRoleEntity[]>();
  userRoleAssignmentsRaw.forEach((assignment) => {
    if (!organizationById.has(assignment.orgRandId)) return;
    const list = roleAssignmentsByUser.get(assignment.userRandId) || [];
    list.push(assignment);
    roleAssignmentsByUser.set(assignment.userRandId, list);
  });

  const membershipsByUser = new Map<string, UserTenantMembershipEntity[]>();
  tenantMemberships.forEach((membership) => {
    const list = membershipsByUser.get(membership.userRandId) || [];
    list.push(membership);
    membershipsByUser.set(membership.userRandId, list);
  });

  const directoryUsers: TenantDirectoryUser[] = users.map((user) => {
    const orgAssignments = orgAssignmentsByUser.get(user.randId) || [];
    const roleAssignments = roleAssignmentsByUser.get(user.randId) || [];
    const memberships = membershipsByUser.get(user.randId) || [];
    const latestMembership = memberships[0] || null;

    const organizationsForUser = orgAssignments.map((assignment) => {
      const org = organizationById.get(assignment.orgRandId);
      return {
        orgRandId: assignment.orgRandId,
        orgCode: org?.code || null,
        orgName: org?.name || null,
        orgPath: org?.path || null,
      };
    });

    const rolesForUser: TenantDirectoryRole[] = roleAssignments
      .map((assignment) => {
        const role = roleById.get(assignment.roleRandId);
        const org = organizationById.get(assignment.orgRandId);
        if (!role) return null;
        return {
          roleRandId: role.randId,
          roleCode: role.roleCode,
          roleName: role.roleName,
          orgRandId: assignment.orgRandId,
          orgPath: org?.path || null,
        };
      })
      .filter((item): item is TenantDirectoryRole => Boolean(item));

    return {
      randId: user.randId,
      email: user.email,
      phoneNumber: user.phoneNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      organizations: organizationsForUser,
      roles: rolesForUser,
      signupContext: latestMembership
        ? {
            orgRandId: latestMembership.orgRandId || null,
            source: latestMembership.source,
            changedAt: latestMembership.changedAt.toISOString(),
          }
        : null,
    };
  });

  return {
    tenantName: normalizedTenantName,
    rootOrgRandId: scope.rootOrgRandId,
    organizations,
    users: directoryUsers,
    builtAt: new Date().toISOString(),
  };
};

const getDirectorySnapshot = async (tenantName: string): Promise<TenantDirectorySnapshot> => {
  const normalizedTenantName = normalizeTenantName(tenantName);
  const cached = cache.get(normalizedTenantName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  const running = inFlight.get(normalizedTenantName);
  if (running) return running;

  const task = buildTenantDirectorySnapshot(normalizedTenantName)
    .then((snapshot) => {
      cache.set(normalizedTenantName, {
        snapshot,
        expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS,
      });
      return snapshot;
    })
    .finally(() => {
      inFlight.delete(normalizedTenantName);
    });

  inFlight.set(normalizedTenantName, task);
  return task;
};

const resolveOuByPath = (
  snapshot: TenantDirectorySnapshot,
  ouPath: string,
): TenantDirectoryOrganization | null => {
  const normalized = normalizePath(ouPath);
  if (!normalized) {
    if (snapshot.rootOrgRandId) {
      return snapshot.organizations.find((org) => org.randId === snapshot.rootOrgRandId) || null;
    }
    return snapshot.organizations.find((org) => org.depth === 0) || null;
  }

  return (
    snapshot.organizations.find((org) => org.path === normalized || org.randId.toLowerCase() === normalized) ||
    null
  );
};

export const getTenantOrgDirectory = async (tenantName: string) => {
  const snapshot = await getDirectorySnapshot(tenantName);
  const rootOrg =
    snapshot.rootOrgRandId
      ? snapshot.organizations.find((org) => org.randId === snapshot.rootOrgRandId) || null
      : null;
  return {
    tenantName: snapshot.tenantName,
    rootOrg,
    organizations: snapshot.organizations,
    builtAt: snapshot.builtAt,
    cacheTtlSec: Math.floor(DIRECTORY_CACHE_TTL_MS / 1000),
  };
};

export const getTenantOu = async (tenantName: string, ouPath: string) => {
  const snapshot = await getDirectorySnapshot(tenantName);
  const target = resolveOuByPath(snapshot, ouPath);
  if (!target) {
    const error = new Error('OU path not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  const descendants = snapshot.organizations.filter(
    (org) => org.path === target.path || org.path.startsWith(`${target.path}/`),
  );
  return {
    tenantName: snapshot.tenantName,
    ou: target,
    descendants,
    builtAt: snapshot.builtAt,
    cacheTtlSec: Math.floor(DIRECTORY_CACHE_TTL_MS / 1000),
  };
};

export const getTenantUsersByOu = async (tenantName: string, ouPath: string) => {
  const snapshot = await getDirectorySnapshot(tenantName);
  const target = resolveOuByPath(snapshot, ouPath);
  if (!target) {
    const error = new Error('OU path not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }

  const subtree = buildSubtreeIndex(snapshot.organizations).get(target.randId) || new Set<string>();
  const users = snapshot.users.filter((user) => {
    const orgHit = user.organizations.some((org) => subtree.has(org.orgRandId));
    if (orgHit) return true;
    return Boolean(user.signupContext?.orgRandId && subtree.has(user.signupContext.orgRandId));
  });

  return {
    tenantName: snapshot.tenantName,
    ou: target,
    users,
    total: users.length,
    builtAt: snapshot.builtAt,
    cacheTtlSec: Math.floor(DIRECTORY_CACHE_TTL_MS / 1000),
  };
};

