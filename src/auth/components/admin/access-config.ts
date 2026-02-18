export interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
    isAuthAdmin?: boolean;
  };
}

export interface OrganizationItem {
  randId: string;
  name: string;
  code: string;
  parentOrgRandId: string | null;
  isActive: boolean;
  changedAt: string;
}

export interface RoleItem {
  randId: string;
  roleName: string;
  roleCode: string;
  orgRandId: string;
  orgName: string | null;
  isActive: boolean;
  changedAt: string;
}

export interface TenantMappingItem {
  tenantName: string;
  tenantRandId: string | null;
  isActive: boolean;
  allowRegistration: boolean;
  organizationRandId: string | null;
  organizationName: string | null;
  organizationCode: string | null;
  updatedAt: string;
}

export interface UserOrgAssignment {
  assignmentRandId: string;
  orgRandId: string;
  orgName: string;
  orgCode: string | null;
  isAssignmentActive: boolean;
}

export interface UserRoleAssignment {
  assignmentRandId: string;
  roleRandId: string;
  roleName: string;
  roleCode: string | null;
  orgRandId: string;
  orgName: string | null;
  isAssignmentActive: boolean;
}

export interface AccessUserItem {
  randId: string;
  email: string;
  phoneNumber: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAuthAdmin: boolean;
  organizations: UserOrgAssignment[];
  roles: UserRoleAssignment[];
  signupContexts?: Array<{
    tenantName: string;
    tenantRandId: string | null;
    orgRandId: string | null;
    source: string;
    changedAt: string;
  }>;
  changedAt: string;
}

export interface UsersResponse {
  page: number;
  limit: number;
  total: number;
  items: AccessUserItem[];
}

export interface OrgTreeNode {
  org: OrganizationItem;
  depth: number;
}

export const cardClass = 'rounded-[24px] p-6';
export const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-[#5F6368]';
export const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition focus:border-[#1A73E8] focus:ring-2 focus:ring-[#D2E3FC]';
export const checkboxClass = 'h-4 w-4 rounded border-[#C7C9CC] text-[#1A73E8] focus:ring-[#D2E3FC]';
export const primaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#1765cc] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#F6F9FE] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';

export const asErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  return fallback;
};

export const flattenOrganizations = (items: OrganizationItem[]): OrgTreeNode[] => {
  const byId = new Map(items.map((org) => [org.randId, org]));
  const children = new Map<string, OrganizationItem[]>();

  for (const org of items) {
    if (!org.parentOrgRandId || !byId.has(org.parentOrgRandId)) continue;
    const list = children.get(org.parentOrgRandId) || [];
    list.push(org);
    children.set(org.parentOrgRandId, list);
  }

  for (const list of children.values()) {
    list.sort((left, right) => left.name.localeCompare(right.name));
  }

  const roots = items
    .filter((org) => !org.parentOrgRandId || !byId.has(org.parentOrgRandId))
    .sort((left, right) => left.name.localeCompare(right.name));

  const out: OrgTreeNode[] = [];
  const visited = new Set<string>();

  const visit = (org: OrganizationItem, depth: number) => {
    if (visited.has(org.randId)) return;
    visited.add(org.randId);
    out.push({ org, depth });
    const childNodes = children.get(org.randId) || [];
    for (const child of childNodes) {
      visit(child, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  for (const org of items) {
    if (!visited.has(org.randId)) {
      visit(org, 0);
    }
  }

  return out;
};
