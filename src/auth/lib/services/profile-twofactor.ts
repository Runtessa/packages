import { assertPhone, normalizeText } from '../validation';
import { schemas, upsertVersionedRecord } from './versioning';
import { buildTotpUri, generateTotpSecret, normalizeTotpCode, verifyTotpCode } from './totp';
import { asObject, normalizeTwoFactorMethod } from './profile-normalizers';
import { readCurrentUser } from './profile-user';
import type { TwoFactorSetupPayload, UpdateTwoFactorInput } from './profile';

export const updateTwoFactorSettings = async (
  userRandId: string,
  input: UpdateTwoFactorInput,
  actorUserRandId: string,
): Promise<void> => {
  const user = await readCurrentUser(userRandId);
  const enabled = Boolean(input.enabled);
  const method = enabled ? normalizeTwoFactorMethod(input.method) : 'none';

  const meta = asObject(user.meta);
  const securityMeta = asObject(meta.security);

  let twoFactorPhone: string | null = null;
  if (enabled && method === 'sms') {
    const candidate = normalizeText(input.phoneNumber ?? user.phoneNumber, 32);
    twoFactorPhone = assertPhone(candidate);
  }

  const nextSecurity = {
    ...securityMeta,
    twoFactorEnabled: enabled,
    twoFactorMethod: method,
    twoFactorPhone,
    updatedAt: new Date().toISOString(),
  };

  await upsertVersionedRecord(
    schemas.users,
    user.randId,
    {
      meta: {
        ...meta,
        security: nextSecurity,
      },
    },
    {
      actorUserRandId,
      changeReason: 'profile-2fa-updated',
    },
  );
};

export const createTwoFactorSetup = async (
  userRandId: string,
  actorUserRandId: string,
): Promise<TwoFactorSetupPayload> => {
  const user = await readCurrentUser(userRandId);
  const secret = generateTotpSecret();
  const otpauthUri = buildTotpUri({ secret, accountName: user.email });

  const meta = asObject(user.meta);
  const securityMeta = asObject(meta.security);
  const nextSecurity = {
    ...securityMeta,
    twoFactorPendingSecret: secret,
    twoFactorPendingIssuedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await upsertVersionedRecord(
    schemas.users,
    user.randId,
    {
      meta: {
        ...meta,
        security: nextSecurity,
      },
    },
    {
      actorUserRandId,
      changeReason: 'profile-2fa-setup-created',
    },
  );

  return { secret, otpauthUri };
};

export const enableTwoFactorWithCode = async (
  userRandId: string,
  verificationCode: string,
  actorUserRandId: string,
): Promise<void> => {
  const user = await readCurrentUser(userRandId);
  const code = normalizeTotpCode(verificationCode);
  if (code.length !== 6) {
    const error = new Error('Verification code must be 6 digits');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const meta = asObject(user.meta);
  const securityMeta = asObject(meta.security);
  const pendingSecret =
    typeof securityMeta.twoFactorPendingSecret === 'string' && securityMeta.twoFactorPendingSecret.trim()
      ? securityMeta.twoFactorPendingSecret.trim()
      : null;
  const activeSecret =
    typeof securityMeta.twoFactorSecret === 'string' && securityMeta.twoFactorSecret.trim()
      ? securityMeta.twoFactorSecret.trim()
      : null;
  const secret = pendingSecret || activeSecret;
  if (!secret) {
    const error = new Error('Setup is required before enabling 2FA');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const valid = verifyTotpCode({ secret, code });
  if (!valid) {
    const error = new Error('Verification code is invalid');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const nextSecurity = {
    ...securityMeta,
    twoFactorEnabled: true,
    twoFactorMethod: 'app',
    twoFactorPhone: null,
    twoFactorSecret: secret,
    twoFactorPendingSecret: null,
    twoFactorPendingIssuedAt: null,
    updatedAt: new Date().toISOString(),
  };

  await upsertVersionedRecord(
    schemas.users,
    user.randId,
    {
      meta: {
        ...meta,
        security: nextSecurity,
      },
    },
    {
      actorUserRandId,
      changeReason: 'profile-2fa-enabled',
    },
  );
};

export const disableTwoFactor = async (
  userRandId: string,
  actorUserRandId: string,
): Promise<void> => {
  const user = await readCurrentUser(userRandId);
  const meta = asObject(user.meta);
  const securityMeta = asObject(meta.security);
  const nextSecurity = {
    ...securityMeta,
    twoFactorEnabled: false,
    twoFactorMethod: 'none',
    twoFactorPhone: null,
    twoFactorSecret: null,
    twoFactorPendingSecret: null,
    twoFactorPendingIssuedAt: null,
    updatedAt: new Date().toISOString(),
  };

  await upsertVersionedRecord(
    schemas.users,
    user.randId,
    {
      meta: {
        ...meta,
        security: nextSecurity,
      },
    },
    {
      actorUserRandId,
      changeReason: 'profile-2fa-disabled',
    },
  );
};
