import { EntityManager, EntityTarget } from 'typeorm';
import { AuthDataSource } from '../db';
import {
  OrganizationEntity,
  RoleEntity,
  UserEntity,
  UserOrganizationEntity,
  UserRoleEntity,
} from '../typeorm/entities';

export interface VersionedRecord {
  id: string;
  randId: string;
  versionNo: number;
  isCurrent: boolean;
  previousRowId: string | null;
  changedByUserRandId: string | null;
  changedByTenantRandId: string | null;
  changeReason: string | null;
  changedAt: Date;
  [key: string]: unknown;
}

export interface VersionActor {
  actorUserRandId?: string | null;
  actorTenantRandId?: string | null;
  changeReason?: string | null;
}

export interface VersionSchema {
  entity: EntityTarget<any>;
  mutableFields: string[];
  requiredOnCreate: string[];
}

const isDeepEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left == null && right == null) return true;
  if (typeof left === 'object' || typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
};

const upsertVersionedWithManager = async (
  manager: EntityManager,
  schema: VersionSchema,
  randId: string,
  patch: Record<string, unknown>,
  actor: VersionActor,
): Promise<VersionedRecord> => {
  const repo = manager.getRepository(schema.entity);

  const current = (await repo
    .createQueryBuilder('row')
    .setLock('pessimistic_write')
    .where('row.rand_id = :randId AND row.is_current = true', { randId })
    .getOne()) as VersionedRecord | null;

  if (!current) {
    const creation = repo.create({
      randId,
      versionNo: 1,
      isCurrent: true,
      previousRowId: null,
      changedByUserRandId: actor.actorUserRandId || null,
      changedByTenantRandId: actor.actorTenantRandId || null,
      changeReason: actor.changeReason || null,
      changedAt: new Date(),
    }) as VersionedRecord;

    for (const key of schema.mutableFields) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        creation[key] = patch[key];
      }
    }

    for (const key of schema.requiredOnCreate) {
      const value = creation[key];
      if (value === undefined || value === null || value === '') {
        const error = new Error(`Missing required field: ${String(key)}`);
        (error as Error & { statusCode: number }).statusCode = 400;
        throw error;
      }
    }

    return (await repo.save(creation)) as VersionedRecord;
  }

  const merged = repo.create({ ...current }) as VersionedRecord;
  for (const key of schema.mutableFields) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      merged[key] = patch[key];
    }
  }

  let changed = false;
  for (const key of schema.mutableFields) {
    if (!isDeepEqual(current[key], merged[key])) {
      changed = true;
      break;
    }
  }

  if (!changed) return current;

  current.isCurrent = false;
  await repo.save(current);

  const nextVersion = repo.create({
    ...merged,
    id: undefined,
    versionNo: Number(current.versionNo || 1) + 1,
    isCurrent: true,
    previousRowId: current.id,
    changedByUserRandId: actor.actorUserRandId || null,
    changedByTenantRandId: actor.actorTenantRandId || null,
    changeReason: actor.changeReason || null,
    changedAt: new Date(),
  }) as VersionedRecord;

  return (await repo.save(nextVersion)) as VersionedRecord;
};

export const schemas: Record<string, VersionSchema> = {
  users: {
    entity: UserEntity,
    mutableFields: [
      'nationalId',
      'phoneNumber',
      'isPhoneVerified',
      'registeredAt',
      'isActive',
      'firstName',
      'lastName',
      'email',
      'passwordHash',
      'meta',
    ],
    requiredOnCreate: [
      'nationalId',
      'phoneNumber',
      'isPhoneVerified',
      'registeredAt',
      'isActive',
      'firstName',
      'lastName',
      'email',
      'passwordHash',
      'meta',
    ],
  },
  roles: {
    entity: RoleEntity,
    mutableFields: ['roleName', 'roleCode', 'orgRandId', 'isActive', 'meta'],
    requiredOnCreate: ['roleName', 'roleCode', 'orgRandId', 'isActive', 'meta'],
  },
  organizations: {
    entity: OrganizationEntity,
    mutableFields: ['name', 'code', 'parentOrgRandId', 'isActive', 'meta'],
    requiredOnCreate: ['name', 'code', 'isActive', 'meta'],
  },
  user_roles: {
    entity: UserRoleEntity,
    mutableFields: ['userRandId', 'roleRandId', 'orgRandId', 'isAssignmentActive', 'meta'],
    requiredOnCreate: ['userRandId', 'roleRandId', 'orgRandId', 'isAssignmentActive', 'meta'],
  },
  user_orgs: {
    entity: UserOrganizationEntity,
    mutableFields: ['userRandId', 'orgRandId', 'isAssignmentActive', 'meta'],
    requiredOnCreate: ['userRandId', 'orgRandId', 'isAssignmentActive', 'meta'],
  },
};

export type SyncTableName = keyof typeof schemas;

export const upsertVersionedRecord = async (
  schema: VersionSchema,
  randId: string,
  patch: Record<string, unknown>,
  actor: VersionActor,
): Promise<VersionedRecord> => {
  return AuthDataSource.transaction((manager) =>
    upsertVersionedWithManager(manager, schema, randId, patch, actor),
  );
};

export const upsertSyncRecord = async (
  table: SyncTableName,
  randId: string,
  patch: Record<string, unknown>,
  actor: VersionActor,
): Promise<VersionedRecord> => {
  const schema = schemas[table];
  if (!schema) {
    const error = new Error(`Unsupported table: ${table}`);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  return upsertVersionedRecord(schema, randId, patch, actor);
};

export const findCurrentUserByEmail = async (email: string): Promise<UserEntity | null> => {
  return AuthDataSource.getRepository(UserEntity).findOne({
    where: { email, isCurrent: true },
  });
};

export const findCurrentUserByRandId = async (randId: string): Promise<UserEntity | null> => {
  return AuthDataSource.getRepository(UserEntity).findOne({
    where: { randId, isCurrent: true },
  });
};
