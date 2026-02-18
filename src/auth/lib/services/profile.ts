import { AuthDataSource } from '../db';
import { hashPassword, verifyPassword } from '../crypto';
import { assertPassword, assertPhone, requireString } from '../validation';
import { schemas, upsertVersionedRecord } from './versioning';
import {
  ActivityEntity,
  AuthSessionEntity,
  OrganizationEntity,
  RoleEntity,
  UserOrganizationEntity,
  UserRoleEntity,
} from '../typeorm/entities';
import {
  asObject,
  credentialsFromMeta,
  normalizeAvatarUrl,
  normalizeBirthday,
  normalizeGender,
  parseStoredTwoFactorMethod,
  toIso,
  type TwoFactorMethod,
} from './profile-normalizers';
import { readCurrentUser } from './profile-user';

export type { TwoFactorMethod } from './profile-normalizers';
export {
  createTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactorWithCode,
  updateTwoFactorSettings,
} from './profile-twofactor';

export interface UserProfileSnapshot {
  user: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
    nationalId: string;
    phoneNumber: string;
    isPhoneVerified: boolean;
    registeredAt: string;
    isActive: boolean;
    avatarUrl: string | null;
    birthday: string | null;
    gender: string | null;
  };
  security: {
    hasPassword: boolean;
    twoFactorEnabled: boolean;
    twoFactorMethod: TwoFactorMethod;
    twoFactorPhone: string | null;
    twoFactorAppConfigured: boolean;
    twoFactorSetupPending: boolean;
    updatedAt: string | null;
  };
  organizations: Array<{
    assignmentRandId: string;
    orgRandId: string;
    orgName: string;
    orgCode: string;
    assignedAt: string;
    isAssignmentActive: boolean;
  }>;
  roles: Array<{
    assignmentRandId: string;
    roleRandId: string;
    roleName: string;
    roleCode: string;
    orgRandId: string;
    orgName: string | null;
    assignedAt: string;
    isAssignmentActive: boolean;
  }>;
  audit: {
    lastLoginAt: string | null;
    lastLoginIp: string | null;
    lastLoginUserAgent: string | null;
    lastSeenAt: string | null;
  };
}

export interface UpdateProfileDetailsInput {
  firstName?: string;
  lastName?: string;
  nationalId?: string;
  phoneNumber?: string;
  avatarUrl?: string | null;
  birthday?: string | null;
  gender?: string | null;
}

export interface UpdateTwoFactorInput {
  enabled: boolean;
  method?: string;
  phoneNumber?: string | null;
}

export interface TwoFactorSetupPayload {
  secret: string;
  otpauthUri: string;
}

export const getUserProfileSnapshot = async (userRandId: string): Promise<UserProfileSnapshot> => {
  const user = await readCurrentUser(userRandId);

  const roleAssignmentRepo = AuthDataSource.getRepository(UserRoleEntity);
  const orgAssignmentRepo = AuthDataSource.getRepository(UserOrganizationEntity);
  const roleRepo = AuthDataSource.getRepository(RoleEntity);
  const orgRepo = AuthDataSource.getRepository(OrganizationEntity);
  const activityRepo = AuthDataSource.getRepository(ActivityEntity);
  const sessionRepo = AuthDataSource.getRepository(AuthSessionEntity);

  const [roleAssignments, orgAssignments, roles, orgs, lastLogin, lastSession] = await Promise.all([
    roleAssignmentRepo.find({
      where: { userRandId, isCurrent: true },
      order: { changedAt: 'DESC' },
    }),
    orgAssignmentRepo.find({
      where: { userRandId, isCurrent: true },
      order: { changedAt: 'DESC' },
    }),
    roleRepo.find({ where: { isCurrent: true, isActive: true } }),
    orgRepo.find({ where: { isCurrent: true, isActive: true } }),
    activityRepo.findOne({
      where: { eventType: 'auth.login.success', actorUserRandId: userRandId },
      order: { createdAt: 'DESC' },
    }),
    sessionRepo.findOne({
      where: { userRandId },
      order: { lastSeenAt: 'DESC' },
    }),
  ]);

  const roleByRandId = new Map(roles.map((role) => [role.randId, role]));
  const orgByRandId = new Map(orgs.map((org) => [org.randId, org]));

  const organizations = orgAssignments
    .filter((assignment) => assignment.isAssignmentActive)
    .map((assignment) => {
      const org = orgByRandId.get(assignment.orgRandId);
      return {
        assignmentRandId: assignment.randId,
        orgRandId: assignment.orgRandId,
        orgName: org?.name || assignment.orgRandId,
        orgCode: org?.code || 'n/a',
        assignedAt: assignment.changedAt.toISOString(),
        isAssignmentActive: assignment.isAssignmentActive,
      };
    });

  const rolesOut = roleAssignments
    .filter((assignment) => assignment.isAssignmentActive)
    .map((assignment) => {
      const role = roleByRandId.get(assignment.roleRandId);
      const org = orgByRandId.get(assignment.orgRandId);
      return {
        assignmentRandId: assignment.randId,
        roleRandId: assignment.roleRandId,
        roleName: role?.roleName || assignment.roleRandId,
        roleCode: role?.roleCode || 'n/a',
        orgRandId: assignment.orgRandId,
        orgName: org?.name || null,
        assignedAt: assignment.changedAt.toISOString(),
        isAssignmentActive: assignment.isAssignmentActive,
      };
    });

  const meta = asObject(user.meta);
  const profileMeta = asObject(meta.profile);
  const securityMeta = asObject(meta.security);
  const credentialsMeta = asObject(meta.credentials);
  const twoFactorEnabled = Boolean(securityMeta.twoFactorEnabled);
  const twoFactorMethod = parseStoredTwoFactorMethod(securityMeta.twoFactorMethod);
  const twoFactorPhone =
    typeof securityMeta.twoFactorPhone === 'string' && securityMeta.twoFactorPhone.trim()
      ? securityMeta.twoFactorPhone.trim()
      : null;
  const appSecret =
    typeof securityMeta.twoFactorSecret === 'string' && securityMeta.twoFactorSecret.trim()
      ? securityMeta.twoFactorSecret.trim()
      : null;
  const pendingSecret =
    typeof securityMeta.twoFactorPendingSecret === 'string' && securityMeta.twoFactorPendingSecret.trim()
      ? securityMeta.twoFactorPendingSecret.trim()
      : null;
  const hasPassword = typeof credentialsMeta.hasPassword === 'boolean' ? credentialsMeta.hasPassword : true;

  return {
    user: {
      randId: user.randId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      nationalId: user.nationalId,
      phoneNumber: user.phoneNumber,
      isPhoneVerified: user.isPhoneVerified,
      registeredAt: user.registeredAt.toISOString(),
      isActive: user.isActive,
      avatarUrl: typeof profileMeta.avatarUrl === 'string' && profileMeta.avatarUrl ? profileMeta.avatarUrl : null,
      birthday: typeof profileMeta.birthday === 'string' && profileMeta.birthday ? profileMeta.birthday : null,
      gender: typeof profileMeta.gender === 'string' && profileMeta.gender ? profileMeta.gender : null,
    },
    security: {
      hasPassword,
      twoFactorEnabled,
      twoFactorMethod: twoFactorEnabled ? twoFactorMethod : 'none',
      twoFactorPhone,
      twoFactorAppConfigured: Boolean(appSecret),
      twoFactorSetupPending: Boolean(pendingSecret),
      updatedAt: toIso(
        typeof securityMeta.updatedAt === 'string' || securityMeta.updatedAt instanceof Date
          ? (securityMeta.updatedAt as string | Date)
          : null,
      ),
    },
    organizations,
    roles: rolesOut,
    audit: {
      lastLoginAt: toIso(lastLogin?.createdAt),
      lastLoginIp: lastLogin?.ipAddress || null,
      lastLoginUserAgent: lastLogin?.userAgent || null,
      lastSeenAt: toIso(lastSession?.lastSeenAt || lastSession?.createdAt || null),
    },
  };
};

export const updateProfileDetails = async (
  userRandId: string,
  input: UpdateProfileDetailsInput,
  actorUserRandId: string,
): Promise<void> => {
  const user = await readCurrentUser(userRandId);

  const patch: Record<string, unknown> = {};
  if (input.firstName !== undefined) patch.firstName = requireString(input.firstName, 'firstName', 1, 120);
  if (input.lastName !== undefined) patch.lastName = requireString(input.lastName, 'lastName', 1, 120);
  if (input.nationalId !== undefined) patch.nationalId = requireString(input.nationalId, 'nationalId', 4, 96);
  if (input.phoneNumber !== undefined) patch.phoneNumber = assertPhone(input.phoneNumber);
  const shouldPatchProfileMeta =
    input.avatarUrl !== undefined || input.birthday !== undefined || input.gender !== undefined;
  if (shouldPatchProfileMeta) {
    const meta = asObject(user.meta);
    const profileMeta = asObject(meta.profile);
    const nextAvatarUrl = input.avatarUrl !== undefined ? normalizeAvatarUrl(input.avatarUrl) : profileMeta.avatarUrl;
    const nextBirthday = input.birthday !== undefined ? normalizeBirthday(input.birthday) : profileMeta.birthday;
    const nextGender = input.gender !== undefined ? normalizeGender(input.gender) : profileMeta.gender;
    patch.meta = {
      ...meta,
      profile: {
        ...profileMeta,
        avatarUrl: nextAvatarUrl,
        birthday: nextBirthday,
        gender: nextGender,
      },
    };
  }

  await upsertVersionedRecord(
    schemas.users,
    user.randId,
    patch,
    {
      actorUserRandId,
      changeReason: 'profile-details-updated',
    },
  );
};

export const updateProfilePassword = async (
  userRandId: string,
  currentPassword: string,
  nextPassword: string,
  actorUserRandId: string,
): Promise<void> => {
  const user = await readCurrentUser(userRandId);
  const next = assertPassword(nextPassword);
  const credentials = credentialsFromMeta(user.meta);
  const hasPassword = typeof credentials.hasPassword === 'boolean' ? credentials.hasPassword : true;

  if (hasPassword) {
    const current = assertPassword(currentPassword);
    const passwordOk = await verifyPassword(current, user.passwordHash);
    if (!passwordOk) {
      const error = new Error('Current password is incorrect');
      (error as Error & { statusCode: number }).statusCode = 403;
      throw error;
    }
  } else if (String(currentPassword || '').trim()) {
    const error = new Error('Current password is not required for first password setup');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  if (hasPassword) {
    const reused = await verifyPassword(next, user.passwordHash);
    if (reused) {
      const error = new Error('New password must be different from current password');
      (error as Error & { statusCode: number }).statusCode = 400;
      throw error;
    }
  }

  const meta = asObject(user.meta);
  const nextMeta = {
    ...meta,
    credentials: {
      ...credentials,
      hasPassword: true,
    },
  };

  await upsertVersionedRecord(
    schemas.users,
    user.randId,
    { passwordHash: await hashPassword(next), meta: nextMeta },
    {
      actorUserRandId,
      changeReason: 'profile-password-updated',
    },
  );
};
