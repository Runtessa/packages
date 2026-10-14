import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/** Recovery material is separate from application keys and stays outside Git. */
export function sealRecoveryBundle(data: Buffer, passphrase: string): Buffer {
  if (passphrase.length < 24) throw new Error('Recovery passphrase must contain at least 24 characters');
  const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from('runtessa-recovery:v1'));
  return Buffer.from(JSON.stringify({ version: 1, salt: salt.toString('hex'), iv: iv.toString('hex'),
    data: Buffer.concat([cipher.update(data), cipher.final()]).toString('base64'),
    authTag: cipher.getAuthTag().toString('hex') }));
}
export function openRecoveryBundle(bundle: Buffer, passphrase: string): Buffer {
  try {
    const data = JSON.parse(bundle.toString('utf8'));
    if (data.version !== 1 || !/^[a-f0-9]{32}$/.test(data.salt) || !/^[a-f0-9]{24}$/.test(data.iv)
      || !/^[a-f0-9]{32}$/.test(data.authTag) || typeof data.data !== 'string') throw new Error('Invalid bundle');
    const key = scryptSync(passphrase, Buffer.from(data.salt, 'hex'), 32);
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'hex'));
    cipher.setAAD(Buffer.from('runtessa-recovery:v1')); cipher.setAuthTag(Buffer.from(data.authTag, 'hex'));
    return Buffer.concat([cipher.update(Buffer.from(data.data, 'base64')), cipher.final()]);
  } catch { throw new Error('Recovery bundle could not be authenticated'); }
}
