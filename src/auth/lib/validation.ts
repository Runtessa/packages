const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[-()\d\s]{7,24}$/;
const CODE_REGEX = /^[a-zA-Z0-9._-]{2,64}$/;

export const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
export const normalizePhone = (value: unknown): string => String(value || '').trim();
export const normalizeText = (value: unknown, max = 256): string => String(value || '').trim().slice(0, max);

export const requireString = (value: unknown, fieldName: string, min = 1, max = 256): string => {
  const normalized = normalizeText(value, max);
  if (normalized.length < min) {
    const error = new Error(`${fieldName} is required`);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  return normalized;
};

export const assertEmail = (value: unknown): string => {
  const normalized = normalizeEmail(value);
  if (!EMAIL_REGEX.test(normalized)) {
    const error = new Error('Invalid email');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  return normalized;
};

export const assertPassword = (value: unknown): string => {
  const normalized = String(value || '');
  if (normalized.length < 10 || normalized.length > 128) {
    const error = new Error('Password must be between 10 and 128 characters');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  return normalized;
};

export const assertPhone = (value: unknown): string => {
  const normalized = normalizePhone(value);
  if (!PHONE_REGEX.test(normalized)) {
    const error = new Error('Invalid phone number');
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  return normalized;
};

export const assertCode = (value: unknown, fieldName: string): string => {
  const normalized = normalizeText(value, 64);
  if (!CODE_REGEX.test(normalized)) {
    const error = new Error(`Invalid ${fieldName}`);
    (error as Error & { statusCode: number }).statusCode = 400;
    throw error;
  }
  return normalized;
};
