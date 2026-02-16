import { MoreThan, IsNull } from 'typeorm';
import { AuthDataSource } from '../db';
import { hashValue, randomId } from '../crypto';
import { config } from '../config';
import { OtpChallengeEntity } from '../typeorm/entities';
import { assertPhone } from '../validation';
import { sendOtpSms } from './sms';

const OTP_TTL_SEC = config.otp.ttlSec;
const OTP_MAX_ATTEMPTS = 5;
const OTP_CODE_LENGTH = 6;

export type OtpPurpose = 'login_2fa' | 'login_otp' | 'signup';

const now = (): Date => new Date();

const generateOtpCode = (): string => {
  const min = 10 ** (OTP_CODE_LENGTH - 1);
  const max = 10 ** OTP_CODE_LENGTH;
  return String(Math.floor(Math.random() * (max - min)) + min);
};

const asPayload = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export interface IssueOtpChallengeInput {
  purpose: OtpPurpose;
  destinationPhone: string;
  payload?: Record<string, unknown>;
  ttlSec?: number;
}

export interface VerifyOtpChallengeInput {
  purpose: OtpPurpose;
  destinationPhone: string;
  code: string;
}

export interface IssuedOtpChallenge {
  challengeRandId: string;
  code: string;
  expiresAt: Date;
  resendAvailableAt: Date;
}

export interface VerifiedOtpChallenge {
  challengeRandId: string;
  payload: Record<string, unknown>;
}

export const issueOtpChallenge = async ({
  purpose,
  destinationPhone,
  payload,
  ttlSec,
}: IssueOtpChallengeInput): Promise<IssuedOtpChallenge> => {
  const destination = assertPhone(destinationPhone);
  const expiresAt = new Date(Date.now() + Math.max(30, ttlSec || OTP_TTL_SEC) * 1000);
  const resendAvailableAt = new Date(Date.now() + config.otp.resendIntervalSec * 1000);
  const code = generateOtpCode();
  const repo = AuthDataSource.getRepository(OtpChallengeEntity);

  const latestAnyStatus = await repo.findOne({
    where: { purpose, destination },
    order: { createdAt: 'DESC' },
  });
  if (latestAnyStatus) {
    const elapsedSec = Math.floor((Date.now() - latestAnyStatus.createdAt.getTime()) / 1000);
    const cooldownSec = Math.max(0, config.otp.resendIntervalSec - elapsedSec);
    if (cooldownSec > 0) {
      const error = new Error(`Please wait ${cooldownSec}s before requesting a new OTP`);
      const typedError = error as Error & {
        statusCode: number;
        retryAfterSec: number;
        retryAfterAt: number;
      };
      typedError.statusCode = 429;
      typedError.retryAfterSec = cooldownSec;
      typedError.retryAfterAt = Date.now() + cooldownSec * 1000;
      throw error;
    }
  }

  // Keep only one active challenge per purpose/phone to reduce replay confusion.
  await repo.update(
    {
      purpose,
      destination,
      consumedAt: IsNull(),
      expiresAt: MoreThan(now()),
    },
    { consumedAt: now() },
  );

  const challengeRandId = randomId(16);
  await sendOtpSms({
    phoneNumber: destination,
    code,
    clientReferenceId: challengeRandId,
  });

  const challenge = repo.create({
    randId: challengeRandId,
    purpose,
    channel: 'sms',
    destination,
    codeHash: hashValue(code),
    attemptsUsed: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt,
    consumedAt: null,
    payload: payload || {},
  });

  const saved = await repo.save(challenge);
  return { challengeRandId: saved.randId, code, expiresAt, resendAvailableAt };
};

export const verifyOtpChallenge = async ({
  purpose,
  destinationPhone,
  code,
}: VerifyOtpChallengeInput): Promise<VerifiedOtpChallenge> => {
  const destination = assertPhone(destinationPhone);
  const normalizedCode = String(code || '').trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    const error = new Error('OTP code must be 6 digits');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  const repo = AuthDataSource.getRepository(OtpChallengeEntity);
  const challenge = await repo.findOne({
    where: {
      purpose,
      destination,
      consumedAt: IsNull(),
    },
    order: { createdAt: 'DESC' },
  });

  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    if (challenge && !challenge.consumedAt) {
      challenge.consumedAt = now();
      await repo.save(challenge);
    }
    const error = new Error('OTP expired, request a new code');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  if (challenge.attemptsUsed >= challenge.maxAttempts) {
    challenge.consumedAt = now();
    await repo.save(challenge);
    const error = new Error('OTP attempts exceeded, request a new code');
    (error as Error & { statusCode: number }).statusCode = 429;
    throw error;
  }

  const matches = hashValue(normalizedCode) === challenge.codeHash;
  if (!matches) {
    challenge.attemptsUsed += 1;
    if (challenge.attemptsUsed >= challenge.maxAttempts) {
      challenge.consumedAt = now();
    }
    await repo.save(challenge);
    const error = new Error('Invalid OTP code');
    (error as Error & { statusCode: number }).statusCode = 401;
    throw error;
  }

  challenge.attemptsUsed += 1;
  challenge.consumedAt = now();
  await repo.save(challenge);

  return {
    challengeRandId: challenge.randId,
    payload: asPayload(challenge.payload),
  };
};
