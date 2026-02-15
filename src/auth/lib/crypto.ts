import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { config } from './config';

export const randomId = (bytes = 24): string => crypto.randomBytes(bytes).toString('base64url');

export const hashValue = (value: string): string =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

export const hashPassword = async (plainText: string): Promise<string> =>
  bcrypt.hash(plainText, config.bcryptRounds);

export const verifyPassword = async (plainText: string, hashedValue: string): Promise<boolean> => {
  if (!plainText || !hashedValue) return false;
  return bcrypt.compare(plainText, hashedValue);
};

export const safeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
