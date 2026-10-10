import type { QueryRunner } from 'typeorm';
import { allPlatformMigrations, migrationChecksum } from './migration-registry';
import type { PlatformMigration } from './migration-types';

export class PlatformSchemaError extends Error {
  readonly statusCode = 503;
  readonly userMessage = 'Database schema is not ready. Please contact the administrator.';
}
export type MigrationHistory = { id: string; checksum: string }[];
export const readMigrationHistory = async (runner: QueryRunner): Promise<MigrationHistory> => {
  const [row] = await runner.query("SELECT to_regclass('public.idp_schema_migrations') AS table_name");
  if (!row?.table_name) return [];
  return runner.query('SELECT id, checksum FROM public.idp_schema_migrations ORDER BY id');
};
export const validateMigrationHistory = (history: MigrationHistory): void => {
  for (const row of history) {
    const migration = allPlatformMigrations.find((entry) => entry.id === row.id);
    if (!migration) throw new PlatformSchemaError('Database has a migration unknown to this release; use a matching release');
    if (migrationChecksum(migration) !== row.checksum) {
      throw new PlatformSchemaError(`Migration checksum mismatch: ${migration.id}; restore the original migration`);
    }
  }
};
export const pendingMigrations = (history: MigrationHistory, migrations: readonly PlatformMigration[]): PlatformMigration[] => {
  validateMigrationHistory(history);
  const applied = new Set(history.map((row) => row.id));
  const pending = migrations.filter((migration) => !applied.has(migration.id));
  for (const migration of allPlatformMigrations) {
    if (applied.has(migration.id) && migration.dependencies?.some((id) => !applied.has(id))) {
      throw new PlatformSchemaError('Migration history has missing dependencies; inspect it before proceeding');
    }
  }
  const available = new Set(applied);
  for (const migration of migrations) {
    if (migration.dependencies?.some((id) => !available.has(id))) {
      throw new PlatformSchemaError('Migration stream has missing or misordered dependencies; inspect the release manifest');
    }
    available.add(migration.id);
  }
  return pending;
};
