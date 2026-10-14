import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type SecretPayload = { iv: string; authTag: string; encryptedValue: string };
export const encryptionKeyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 24);
export const previousEncryptionKeys = (value = process.env.ENCRYPTION_PREVIOUS_KEYS || ''): Buffer[] => {
  const keys = value.split(',').map((key) => key.trim()).filter(Boolean);
  if (keys.length > 8 || keys.some((key) => !/^[a-fA-F0-9]{64}$/.test(key)))
    throw new Error('ENCRYPTION_PREVIOUS_KEYS must contain at most eight private 32-byte hexadecimal keys');
  return keys.map((key) => Buffer.from(key, 'hex'));
};

export function encryptSecretPayload(value: string, key: Buffer): SecretPayload {
  if (key.length !== 32) throw new Error('Encryption key must contain 32 bytes');
  const id = encryptionKeyId(key), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`runtessa-secret:v2:${id}`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex'), encryptedValue: `v2.${id}.${encrypted.toString('hex')}` };
}

export function decryptSecretPayload(payload: SecretPayload, keys: readonly Buffer[]): string {
  if (!/^[a-f0-9]{24}$/i.test(payload.iv) || !/^[a-f0-9]{32}$/i.test(payload.authTag)) throw new Error('Invalid encrypted secret');
  const parts = payload.encryptedValue.split('.');
  const versioned = parts.length === 3 && parts[0] === 'v2';
  const ciphertext = versioned ? parts[2] : payload.encryptedValue;
  if (!/^(?:[a-f0-9]{2})*$/i.test(ciphertext) || (versioned && !/^[a-f0-9]{24}$/.test(parts[1]))) throw new Error('Invalid encrypted secret');
  for (const key of keys) {
    if (key.length !== 32 || (versioned && encryptionKeyId(key) !== parts[1])) continue;
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
      if (versioned) cipher.setAAD(Buffer.from(`runtessa-secret:v2:${parts[1]}`));
      cipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));
      return Buffer.concat([cipher.update(Buffer.from(ciphertext, 'hex')), cipher.final()]).toString('utf8');
    } catch { /* Try retained keys for unversioned records; never expose plaintext or key material. */ }
  }
  throw new Error('Encrypted secret cannot be recovered with the configured keys');
}
