import { DataSource } from 'typeorm';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { Secret } from '@idp/shared';
import { Tenant } from '@idp/shared';

const isEncryptedMarker = (value: string) => value.startsWith('enc:');

const parseEncryptedValue = (value: string) => {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'enc') return null;
  return {
    iv: parts[1],
    authTag: parts[2],
    encryptedValue: parts[3],
  };
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasMaskedPassword = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry) => hasMaskedPassword(entry));
  }
  if (isObject(value)) {
    return Object.entries(value).some(([key, entry]) => {
      if (key === 'password' && typeof entry === 'string' && isEncryptedMarker(entry)) {
        return true;
      }
      return hasMaskedPassword(entry);
    });
  }
  return false;
};

const mergePasswordFields = (next: unknown, prev: unknown): unknown => {
  if (Array.isArray(next)) {
    const prevArray = Array.isArray(prev) ? prev : [];
    return next.map((entry, index) => mergePasswordFields(entry, prevArray[index]));
  }
  if (isObject(next)) {
    const prevObj = isObject(prev) ? prev : {};
    const merged: Record<string, unknown> = { ...next };
    Object.entries(next).forEach(([key, value]) => {
      if (key === 'password' && typeof value === 'string' && isEncryptedMarker(value)) {
        merged[key] = (prevObj as Record<string, unknown>)[key] ?? value;
        return;
      }
      if (isObject(value) || Array.isArray(value)) {
        merged[key] = mergePasswordFields(value, (prevObj as Record<string, unknown>)[key]);
      }
    });
    return merged;
  }
  return next;
};

const getSecretValue = async (
  dataSource: DataSource,
  tenant: Tenant,
  adapter: string,
  key: string
) => {
  const repo = dataSource.getRepository(Secret);
  const rawKey = key.trim();
  const lowerKey = rawKey.toLowerCase();
  const adapterLower = adapter.toLowerCase();
  const candidates = [
    `${adapterLower}:${lowerKey}`,
    `${adapterLower}:${rawKey}`,
    lowerKey,
    rawKey,
  ];
  for (const candidate of candidates) {
    const secret = await repo.findOne({ where: { tenant: { id: tenant.id }, keyName: candidate } });
    if (secret) {
      return decryptSecret({
        encryptedValue: secret.encryptedValue,
        authTag: secret.authTag,
        iv: secret.iv,
      });
    }
  }
  throw new Error(`Secret ${rawKey} not found for tenant`);
};

export const resolveMaskedPasswords = async (
  config: Record<string, unknown>,
  dataSource: DataSource,
  tenant?: Tenant
) => {
  const adapters = (config.adapters ?? config) as Record<string, unknown>;
  for (const [adapterKey, adapterValue] of Object.entries(adapters ?? {})) {
    if (!isObject(adapterValue)) continue;
    for (const [name, entry] of Object.entries(adapterValue)) {
      if (!hasMaskedPassword(entry)) continue;
      if (!tenant) {
        throw new Error(`Password must be provided for ${adapterKey}:${name}`);
      }
      const secretVal = await getSecretValue(dataSource, tenant, adapterKey, name);
      let previousConfig: unknown = secretVal;
      try {
        previousConfig = JSON.parse(secretVal);
      } catch {
        // keep raw string
      }
      (adapterValue as Record<string, unknown>)[name] = mergePasswordFields(entry, previousConfig);
    }
  }
  return config;
};

export const maskPasswordFields = (config: Record<string, unknown>) => {
  const mask = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => mask(entry));
    }
    if (isObject(value)) {
      const next: Record<string, unknown> = {};
      Object.entries(value).forEach(([key, entry]) => {
        if (key === 'password' && typeof entry === 'string') {
          if (isEncryptedMarker(entry)) {
            next[key] = entry;
            return;
          }
          const encrypted = encryptSecret(entry);
          next[key] = `enc:${encrypted.iv}:${encrypted.authTag}:${encrypted.encryptedValue}`;
          return;
        }
        next[key] = mask(entry);
      });
      return next;
    }
    return value;
  };

  return mask(config) as Record<string, unknown>;
};

export const decryptPasswordFields = (config: Record<string, unknown>) => {
  const decode = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => decode(entry));
    }
    if (isObject(value)) {
      const next: Record<string, unknown> = {};
      Object.entries(value).forEach(([key, entry]) => {
        if (key === 'password' && typeof entry === 'string' && isEncryptedMarker(entry)) {
          const parsed = parseEncryptedValue(entry);
          if (!parsed) {
            next[key] = entry;
            return;
          }
          try {
            next[key] = decryptSecret(parsed);
          } catch {
            next[key] = entry;
          }
          return;
        }
        next[key] = decode(entry);
      });
      return next;
    }
    return value;
  };

  return decode(config) as Record<string, unknown>;
};
