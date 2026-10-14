import type { DataSource } from 'typeorm';
import { decryptSecretPayload, encryptSecretPayload } from './secret-crypto';

const rotateMarkers = (value: unknown, keys: readonly Buffer[], next: Buffer): unknown => {
  if (Array.isArray(value)) return value.map((entry) => rotateMarkers(entry, keys, next));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rotateMarkers(entry, keys, next)]));
  if (typeof value === 'string' && value.startsWith('enc:')) {
    const [marker, iv, authTag, encryptedValue, extra] = value.split(':');
    if (marker !== 'enc' || extra !== undefined || !iv || !authTag || encryptedValue === undefined) return value;
    const payload = encryptSecretPayload(decryptSecretPayload({ iv, authTag, encryptedValue }, keys), next);
    return `enc:${payload.iv}:${payload.authTag}:${payload.encryptedValue}`;
  }
  return value;
};

/** Invoke on a restored backup first. All ciphertext and nested adapter passwords rotate in one transaction. */
export async function rotateDatabaseSecrets(source: DataSource, keys: readonly Buffer[], next: Buffer) {
  return source.transaction(async (manager) => {
    await manager.query("SET LOCAL lock_timeout TO '10s'");
    await manager.query('SELECT pg_advisory_xact_lock(1048833, 1)');
    const secrets = await manager.query('SELECT id, iv, "authTag", "encryptedValue" FROM secrets ORDER BY id FOR UPDATE');
    const tenants = await manager.query('SELECT id, "adapterConfig" FROM tenants ORDER BY id FOR UPDATE');
    // Preflight every value before issuing the first update.
    const rotated = secrets.map((secret: any) => {
      let plaintext = decryptSecretPayload(secret, keys);
      let structured: unknown;
      try { structured = JSON.parse(plaintext); } catch { /* Plaintext credentials need no nested traversal. */ }
      if (structured && typeof structured === 'object') plaintext = JSON.stringify(rotateMarkers(structured, keys, next));
      return { id: secret.id, ...encryptSecretPayload(plaintext, next) };
    });
    const configs = tenants.map((tenant: any) => ({ id: tenant.id, value: rotateMarkers(tenant.adapterConfig, keys, next) }));
    for (const secret of rotated) await manager.query('UPDATE secrets SET iv = $2, "authTag" = $3, "encryptedValue" = $4 WHERE id = $1',
      [secret.id, secret.iv, secret.authTag, secret.encryptedValue]);
    for (const tenant of configs) await manager.query('UPDATE tenants SET "adapterConfig" = $2 WHERE id = $1', [tenant.id, tenant.value]);
    return { secrets: rotated.length, tenants: configs.length };
  });
}
