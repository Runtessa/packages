import { getAuthMessages } from '../../../lib/ui/i18n';

export type AccessCopy = ReturnType<typeof getAuthMessages>['access'];

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
