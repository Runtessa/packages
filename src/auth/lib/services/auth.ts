import { hashPassword, randomId, verifyPassword } from '../crypto';
import {
  findCurrentUserByEmail,
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
  email: string;
  password: string;
}

export const authenticateUser = async ({ email, password }: LoginInput): Promise<UserEntity | null> => {
  const normalizedEmail = assertEmail(email);
  const normalizedPassword = assertPassword(password);

  const user = await findCurrentUserByEmail(normalizedEmail);
  if (!user || !user.isActive) return null;

  const ok = await verifyPassword(normalizedPassword, user.passwordHash);
  return ok ? user : null;
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

  if (clientId) {
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
  }

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
      meta: {},
    },
    {
      actorUserRandId: userRandId,
      changeReason: 'self-registration',
    },
  );

  return created as unknown as UserEntity;
};
