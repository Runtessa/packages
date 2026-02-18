import { TenantMappingItem } from '../../access-config';

export type OrgFormState = {
  randId: string;
  name: string;
  code: string;
  parentOrgRandId: string;
  isActive: boolean;
};

export type RoleFormState = {
  randId: string;
  roleName: string;
  roleCode: string;
  orgRandId: string;
  isActive: boolean;
};

export type UserDraftState = Record<string, { orgRandId: string; roleRandId: string }>;

export const USERS_LIMIT = 20;

export const buildUserFilterTenantOptions = (tenantMappings: TenantMappingItem[]): string[] => {
  return tenantMappings
    .map((item) => item.tenantName)
    .filter((value, index, list) => value && list.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
};
