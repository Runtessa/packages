import crypto from 'crypto';
import { safeEqual } from '../crypto';
import { config } from '../config';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const sanitizeBase32 = (value: string): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');

const encodeBase32 = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
};

const decodeBase32 = (input: string): Buffer => {
  const normalized = sanitizeBase32(input);
  if (!normalized) return Buffer.alloc(0);

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
};

const counterBuffer = (counter: number): Buffer => {
  const buffer = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  buffer.writeUInt32BE(high, 0);
  buffer.writeUInt32BE(low, 4);
  return buffer;
};

const generateCodeForCounter = (secret: string, counter: number, digits: number): string => {
  const key = decodeBase32(secret);
  if (!key.length) return '';
  const digest = crypto
    .createHmac('sha1', key)
    .update(counterBuffer(counter))
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const truncated =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const mod = 10 ** digits;
  const code = truncated % mod;
  return String(code).padStart(digits, '0');
};

export const generateTotpSecret = (): string => encodeBase32(crypto.randomBytes(20));

export const normalizeTotpCode = (value: unknown): string => String(value || '').replace(/\D+/g, '');

export const buildTotpUri = ({
  secret,
  accountName,
}: {
  secret: string;
  accountName: string;
}): string => {
  const issuer = config.totp.issuer;
  const label = `${issuer}:${accountName}`;
  const params = new URLSearchParams({
    secret: sanitizeBase32(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(config.totp.digits),
    period: String(config.totp.periodSec),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
};

export const verifyTotpCode = ({
  secret,
  code,
  nowMs = Date.now(),
}: {
  secret: string;
  code: string;
  nowMs?: number;
}): boolean => {
  const normalizedSecret = sanitizeBase32(secret);
  const normalizedCode = normalizeTotpCode(code);
  if (!normalizedSecret || normalizedCode.length !== config.totp.digits) return false;

  const currentCounter = Math.floor(nowMs / 1000 / config.totp.periodSec);
  for (let drift = -config.totp.window; drift <= config.totp.window; drift += 1) {
    const expected = generateCodeForCounter(normalizedSecret, currentCounter + drift, config.totp.digits);
    if (expected && safeEqual(expected, normalizedCode)) return true;
  }
  return false;
};
