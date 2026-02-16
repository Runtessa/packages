import { hashPassword, randomId, verifyPassword } from '../crypto';
import {
  findCurrentUserByEmail,
  findCurrentUserByPhone,
  findCurrentUserByRandId,
  schemas,
  upsertVersionedRecord,
} from './versioning';
import { resolveTenantPolicyByClientId } from '../oauth';
import { UserEntity } from '../typeorm/entities/UserEntity';
import {
  assertEmail,
  assertPassword,
  assertPhone,
  normalizeText,
  requireString,
} from '../validation';

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  phoneNumber: string;
  clientId?: string;
  tenantName?: string;
}

export interface LoginInput {
  phoneNumber: string;
  password: string;
}

export interface RegisterByPhoneInput {
  phoneNumber: string;
  password?: string;
  clientId?: string;
  tenantName?: string;
}

export interface RegisterByPhonePrecheckInput {
  phoneNumber: string;
  clientId?: string;
  tenantName?: string;
}

export interface UserSecurityState {
  twoFactorEnabled: boolean;
  twoFactorMethod: 'none' | 'app' | 'sms';
  twoFactorPhone: string | null;
  twoFactorSecret: string | null;
}

export interface UserLoginCapabilities {
  passwordEnabled: boolean;
}

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const parseTwoFactorMethod = (value: unknown): 'none' | 'app' | 'sms' => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'app' || normalized === 'sms') return normalized;
  return 'none';
};

const assertTenantPolicy = async (clientId?: string, tenantName?: string): Promise<void> => {
  if (!clientId) return;

  const resolved = await resolveTenantPolicyByClientId(clientId, tenantName || null);
  if (!resolved || !resolved.client.isActive) {
    const error = new Error('Invalid tenant client');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  if (!resolved.policy.allowRegistration) {
    const error = new Error('Registration is disabled for this tenant');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }
};

const defaultsFromPhone = (phoneNumber: string): { email: string; nationalId: string; firstName: string; lastName: string } => {
  const compactDigits = phoneNumber.replace(/\D+/g, '') || randomId(6).toLowerCase();
  const suffix = compactDigits.slice(-6).padStart(6, '0');
  return {
    email: `phone-${compactDigits}@auth.local`,
    nationalId: `PHONE-${compactDigits}`,
    firstName: 'User',
    lastName: suffix,
  };
};

const credentialsFromMeta = (metaValue: unknown): Record<string, unknown> => {
  const meta = asObject(metaValue);
  return asObject(meta.credentials);
};

const hasPasswordLogin = (user: UserEntity): boolean => {
  const credentials = credentialsFromMeta(user.meta);
  if (typeof credentials.hasPassword === 'boolean') return credentials.hasPassword;
  return true;
};

const mergeCredentialsMeta = (metaValue: unknown, patch: Record<string, unknown>): Record<string, unknown> => {
  const meta = asObject(metaValue);
  const currentCredentials = asObject(meta.credentials);
  return {
    ...meta,
    credentials: {
      ...currentCredentials,
      ...patch,
    },
  };
};

export const readUserSecurityState = (user: UserEntity): UserSecurityState => {
  const meta = asObject(user.meta);
  const security = asObject(meta.security);
  const twoFactorEnabled = Boolean(security.twoFactorEnabled);
  const twoFactorMethod = twoFactorEnabled ? parseTwoFactorMethod(security.twoFactorMethod) : 'none';
  const configuredPhone =
    typeof security.twoFactorPhone === 'string' && security.twoFactorPhone.trim()
      ? security.twoFactorPhone.trim()
      : null;
  const configuredSecret =
    typeof security.twoFactorSecret === 'string' && security.twoFactorSecret.trim()
      ? security.twoFactorSecret.trim()
      : null;
  return {
    twoFactorEnabled,
    twoFactorMethod,
    twoFactorPhone: configuredPhone,
    twoFactorSecret: configuredSecret,
  };
};

export const authenticateUser = async ({ phoneNumber, password }: LoginInput): Promise<UserEntity | null> => {
  const normalizedPhone = assertPhone(phoneNumber);
  const normalizedPassword = assertPassword(password);

  const user = await findCurrentUserByPhone(normalizedPhone);
  if (!user || !user.isActive) return null;
  if (!hasPasswordLogin(user)) return null;

  const ok = await verifyPassword(normalizedPassword, user.passwordHash);
  return ok ? user : null;
};

export const readActiveUserByPhone = async (phoneNumber: string): Promise<UserEntity | null> => {
  const normalizedPhone = assertPhone(phoneNumber);
  const user = await findCurrentUserByPhone(normalizedPhone);
  if (!user || !user.isActive) return null;
  return user;
};

export const readActiveUserByRandId = async (userRandId: string): Promise<UserEntity | null> => {
  const normalized = normalizeText(userRandId, 64);
  if (!normalized) return null;
  const user = await findCurrentUserByRandId(normalized);
  if (!user || !user.isActive) return null;
  return user;
};

export const readUserLoginCapabilities = (user: UserEntity): UserLoginCapabilities => {
  return {
    passwordEnabled: hasPasswordLogin(user),
  };
};

export const registerUser = async ({
  email,
  password,
  firstName,
  lastName,
  nationalId,
  phoneNumber,
  clientId,
  tenantName,
}: RegisterInput): Promise<UserEntity> => {
  const normalizedEmail = assertEmail(email);
  const normalizedPassword = assertPassword(password);
  const normalizedFirstName = requireString(firstName, 'firstName', 1, 120);
  const normalizedLastName = requireString(lastName, 'lastName', 1, 120);
  const normalizedNationalId = requireString(nationalId, 'nationalId', 4, 96);
  const normalizedPhone = assertPhone(phoneNumber);

  await assertTenantPolicy(clientId, tenantName);

  const existing = await findCurrentUserByEmail(normalizedEmail);
  if (existing) {
    const error = new Error('Email already registered');
    (error as Error & { statusCode: number }).statusCode = 409;
    throw error;
  }

  const userRandId = randomId(16);
  const created = await upsertVersionedRecord(
    schemas.users,
    userRandId,
    {
      nationalId: normalizedNationalId,
      phoneNumber: normalizedPhone,
      isPhoneVerified: false,
      registeredAt: new Date(),
      isActive: true,
      firstName: normalizeText(normalizedFirstName, 120),
      lastName: normalizeText(normalizedLastName, 120),
      email: normalizedEmail,
      passwordHash: await hashPassword(normalizedPassword),
      meta: mergeCredentialsMeta({}, { hasPassword: true }),
    },
    {
      actorUserRandId: userRandId,
      changeReason: 'self-registration',
    },
  );

  return created as unknown as UserEntity;
};

export const registerUserByPhone = async ({
  phoneNumber,
  password,
  clientId,
  tenantName,
}: RegisterByPhoneInput): Promise<UserEntity> => {
  const normalizedPhone = await assertPhoneRegistrationAllowed({
    phoneNumber,
    clientId,
    tenantName,
  });
  const hasPassword = Boolean(String(password || '').trim());
  const effectivePassword = hasPassword ? assertPassword(password) : randomId(24);

  const defaults = defaultsFromPhone(normalizedPhone);
  const existingByEmail = await findCurrentUserByEmail(defaults.email);
  if (existingByEmail) {
    const error = new Error('Phone profile already exists');
    (error as Error & { statusCode: number }).statusCode = 409;
    throw error;
  }

  const userRandId = randomId(16);
  const created = await upsertVersionedRecord(
    schemas.users,
    userRandId,
    {
      nationalId: defaults.nationalId,
      phoneNumber: normalizedPhone,
      isPhoneVerified: true,
      registeredAt: new Date(),
      isActive: true,
      firstName: defaults.firstName,
      lastName: defaults.lastName,
      email: defaults.email,
      passwordHash: await hashPassword(effectivePassword),
      meta: mergeCredentialsMeta({}, { hasPassword }),
    },
    {
      actorUserRandId: userRandId,
      changeReason: 'self-registration-phone-otp',
    },
  );

  return created as unknown as UserEntity;
};

export const assertPhoneRegistrationAllowed = async ({
  phoneNumber,
  clientId,
  tenantName,
}: RegisterByPhonePrecheckInput): Promise<string> => {
  const normalizedPhone = assertPhone(phoneNumber);
  await assertTenantPolicy(clientId, tenantName);

  const existingByPhone = await findCurrentUserByPhone(normalizedPhone);
  if (existingByPhone) {
    const error = new Error('Phone number is already registered');
    (error as Error & { statusCode: number }).statusCode = 409;
    throw error;
  }

  return normalizedPhone;
};
