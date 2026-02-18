import { isManagedAvatarUrl } from './avatar-storage';
import { normalizeText } from '../validation';

export type TwoFactorMethod = 'none' | 'app' | 'sms';

type JsonMap = Record<string, unknown>;

export const asObject = (value: unknown): JsonMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonMap;
};

export const credentialsFromMeta = (value: unknown): JsonMap => {
  const meta = asObject(value);
  return asObject(meta.credentials);
};

export const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString();
};

export const normalizeAvatarUrl = (value: unknown): string | null => {
  const raw = normalizeText(value ?? '', 1024);
  if (!raw) return null;

  if (raw.startsWith('http://') || raw.startsWith('https://') || isManagedAvatarUrl(raw)) {
    return raw;
  }

  const error = new Error('Avatar URL must be an http(s) URL or a managed upload path');
  (error as Error & { statusCode: number }).statusCode = 400;
  throw error;
};

export const normalizeBirthday = (value: unknown): string | null => {
  const raw = normalizeText(value ?? '', 32);
  if (!raw) return null;

  const simpleIso = /^\d{4}-\d{2}-\d{2}$/;
  if (simpleIso.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) {
    const error = new Error('Birthday must be a valid date');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }

  return parsed.toISOString().slice(0, 10);
};

export const normalizeGender = (value: unknown): string | null => {
  const raw = normalizeText(value ?? '', 40);
  if (!raw) return null;
  return raw;
};

export const normalizeTwoFactorMethod = (value: string | undefined): TwoFactorMethod => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized === 'none') return 'none';
  if (normalized === 'app') return 'app';
  if (normalized === 'sms') return 'sms';
  const error = new Error('Invalid 2FA method');
  (error as Error & { statusCode: number }).statusCode = 400;
  throw error;
};

export const parseStoredTwoFactorMethod = (value: unknown): TwoFactorMethod => {
  if (value === 'app' || value === 'sms' || value === 'none') return value;
  return 'none';
};
