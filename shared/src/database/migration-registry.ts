import { createHash } from 'node:crypto';
import { migration as users } from './migrations/0001_platform_users';
import { migration as catalog } from './migrations/0002_platform_catalog';
import { migration as core } from './migrations/0003_platform_core';
import { migration as ide } from './migrations/0004_platform_ide';
import { canonicalJson } from './schema-snapshot';
import type { PlatformMigration, PlatformSchema } from './migration-types';

export const allPlatformMigrations = [users, catalog, core, ide];
export const platformMigrations = (schema: PlatformSchema): PlatformMigration[] =>
  schema === 'core' ? [users, catalog, core] : schema === 'ide' ? [users, ide] : [catalog];
export const migrationChecksum = (migration: PlatformMigration): string =>
  createHash('sha256').update(canonicalJson(migration)).digest('hex');
