import { AuthDataSource } from '../../db';
import {
  OrganizationEntity,
  RoleEntity,
  TenantWhitelistEntity,
} from '../../typeorm/entities';
import { asObject } from './utils';

export const readTenantOrganizationRandId = (row: TenantWhitelistEntity): string | null => {
  const meta = asObject(row.meta);
  const orgRandId = typeof meta.organizationRandId === 'string' ? meta.organizationRandId.trim() : '';
  return orgRandId || null;
};

export const ensureOrganizationExists = async (orgRandId: string): Promise<OrganizationEntity> => {
  const repo = AuthDataSource.getRepository(OrganizationEntity);
  const row = await repo.findOne({ where: { randId: orgRandId, isCurrent: true } });
  if (!row) {
    const error = new Error('Organization not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return row;
};

export const ensureRoleExists = async (roleRandId: string): Promise<RoleEntity> => {
  const repo = AuthDataSource.getRepository(RoleEntity);
  const row = await repo.findOne({ where: { randId: roleRandId, isCurrent: true } });
  if (!row) {
    const error = new Error('Role not found') as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return row;
};
