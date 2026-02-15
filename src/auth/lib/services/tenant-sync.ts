import { SyncTableName, upsertSyncRecord } from './versioning';

interface SyncPayload {
  table: SyncTableName;
  randId: string;
  changes: Record<string, unknown>;
  reason?: string;
  actorUserRandId?: string;
}

const mapKeys = (changes: Record<string, unknown>, table: SyncTableName): Record<string, unknown> => {
  const source = { ...changes };

  const byTable: Record<SyncTableName, Record<string, string>> = {
    users: {
      national_id: 'nationalId',
      phone_number: 'phoneNumber',
      is_phone_verified: 'isPhoneVerified',
      registered_at: 'registeredAt',
      is_active: 'isActive',
      first_name: 'firstName',
      last_name: 'lastName',
      password_hash: 'passwordHash',
    },
    roles: {
      role_name: 'roleName',
      role_code: 'roleCode',
      org_rand_id: 'orgRandId',
      is_active: 'isActive',
    },
    organizations: {
      parent_org_rand_id: 'parentOrgRandId',
      is_active: 'isActive',
    },
    user_roles: {
      user_rand_id: 'userRandId',
      role_rand_id: 'roleRandId',
      org_rand_id: 'orgRandId',
      is_assignment_active: 'isAssignmentActive',
    },
    user_orgs: {
      user_rand_id: 'userRandId',
      org_rand_id: 'orgRandId',
      is_assignment_active: 'isAssignmentActive',
    },
  };

  const dictionary = byTable[table];
  for (const [snake, camel] of Object.entries(dictionary)) {
    if (Object.prototype.hasOwnProperty.call(source, snake)) {
      source[camel] = source[snake];
      delete source[snake];
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'meta') && typeof source.meta !== 'object') {
    source.meta = {};
  }

  return source;
};

export const applyTenantSync = async (
  payload: SyncPayload,
  tenantRandId: string,
): Promise<Record<string, unknown>> => {
  const normalizedChanges = mapKeys(payload.changes, payload.table);
  const updated = await upsertSyncRecord(payload.table, payload.randId, normalizedChanges, {
    actorUserRandId: payload.actorUserRandId || null,
    actorTenantRandId: tenantRandId,
    changeReason: payload.reason || 'tenant-sync',
  });

  return {
    table: payload.table,
    randId: (updated as { randId: string }).randId,
    versionNo: (updated as { versionNo: number }).versionNo,
    isCurrent: (updated as { isCurrent: boolean }).isCurrent,
    changedAt: (updated as { changedAt: Date }).changedAt,
  };
};
