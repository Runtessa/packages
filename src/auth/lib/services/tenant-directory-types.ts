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

export interface TenantDirectorySnapshot {
  tenantName: string;
  rootOrgRandId: string | null;
  organizations: TenantDirectoryOrganization[];
  users: TenantDirectoryUser[];
  builtAt: string;
}

export const DIRECTORY_CACHE_TTL_MS = 30 * 60 * 1000;
