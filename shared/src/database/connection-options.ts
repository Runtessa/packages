import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { catalogEntities, coreEntities, ideEntities } from './entities';
import type { PlatformSchema } from './migration-types';

export const normalizeDatabaseUrl = (url?: string, name?: string): string | undefined => {
  if (!url || !name) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') parsed.pathname = `/${name}`;
    return parsed.toString();
  } catch { return url; }
};

export const platformConnectionOptions = (schema: PlatformSchema, env = process.env): PostgresConnectionOptions => {
  const prefix = schema === 'catalog' ? 'CORE_' : '';
  // A dedicated URL is a complete connection; do not mix in another database's credentials.
  const dedicatedUrl = prefix && env.CORE_DATABASE_URL;
  const value = (key: string) => (prefix ? env[`${prefix}${key}`] : undefined) ||
    (dedicatedUrl && key !== 'DB_TYPE' ? undefined : env[key]);
  if ((value('DB_TYPE') || 'postgres') !== 'postgres') {
    throw new Error('Platform schemas require PostgreSQL; tenant adapters retain their own database types');
  }
  const database = value('DB_NAME');
  return {
    type: 'postgres', schema: 'public',
    url: normalizeDatabaseUrl(value('DATABASE_URL'), database), database,
    host: value('DB_HOST'), port: value('DB_PORT') ? Number(value('DB_PORT')) : undefined,
    username: value('DB_USER'), password: value('DB_PASS'),
    synchronize: false, migrationsRun: false, installExtensions: false, logging: false,
    entities: schema === 'core' ? coreEntities : schema === 'ide' ? ideEntities : catalogEntities,
  };
};
