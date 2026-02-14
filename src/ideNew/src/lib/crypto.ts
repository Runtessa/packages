import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export type EncryptedPayload = {
  iv: string;
  authTag: string;
  encryptedValue: string;
};

const getKeyFromEnv = (envName: string, expectedBytes: number): Buffer => {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is required`);
  }
  const isHex = /^[a-fA-F0-9]+$/.test(raw) && raw.length === expectedBytes * 2;
  const buffer = isHex ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buffer.length !== expectedBytes) {
    throw new Error(`${envName} must decode to ${expectedBytes} bytes`);
  }
  return buffer;
};

export const getEncryptionKey = () => {
  return getKeyFromEnv(
    process.env.CORE_ENCRYPTION_KEY ? 'CORE_ENCRYPTION_KEY' : 'ENCRYPTION_KEY',
    32
  );
};

export const encryptSecret = (value: string): EncryptedPayload => {
  const encryptionKey = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    encryptedValue: encrypted.toString('hex'),
  };
};

export const decryptSecret = (payload: EncryptedPayload): string => {
  const encryptionKey = getEncryptionKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const encrypted = Buffer.from(payload.encryptedValue, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};
