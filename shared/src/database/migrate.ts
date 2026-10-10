import type { DataSource, QueryRunner } from 'typeorm';
import { migrationChecksum, platformMigrations } from './migration-registry';
import { pendingMigrations, PlatformSchemaError, readMigrationHistory } from './migration-history';
import { canonicalJson, snapshotTable } from './schema-snapshot';
import type { PlatformMigration, PlatformSchema } from './migration-types';

const mismatchedTables = async (runner: QueryRunner, migration: PlatformMigration): Promise<string[]> => {
  const actual = new Map((await runner.getTables(migration.tables.map((table) => `public.${table.name}`)))
    .map((table) => { const snapshot = snapshotTable(table); return [snapshot.name, snapshot] as const; }));
  return migration.tables.filter((table) => canonicalJson(actual.get(table.name)) !== canonicalJson(table)).map((table) => table.name);
};

export const runPlatformMigrations = async (source: DataSource, schema: PlatformSchema, adopt = false): Promise<string[]> => {
  if (source.options.type !== 'postgres') throw new PlatformSchemaError('Platform migrations require PostgreSQL');
  const runner = source.createQueryRunner();
  try {
    await runner.connect();
    await runner.startTransaction();
    await runner.query("SET LOCAL lock_timeout TO '10s'");
    await runner.query('SET LOCAL search_path TO public');
    await runner.query('SELECT pg_advisory_xact_lock(1048831, 1)');
    const pending = pendingMigrations(await readMigrationHistory(runner), platformMigrations(schema));
    // Preflight all baselines before writing any schema or history.
    for (const migration of pending) {
      if (adopt) {
        if (migration.kind !== 'baseline') throw new PlatformSchemaError('Only initial baselines may be adopted; apply pending upgrades');
        const mismatches = await mismatchedTables(runner, migration);
        if (mismatches.length) throw new PlatformSchemaError(`Existing schema does not match ${migration.id}: ${mismatches.join(', ')}; review db:diff before adoption`);
      } else if (migration.kind === 'baseline' && (await runner.getTables(migration.tables.map((table) => `public.${table.name}`))).length) {
        throw new PlatformSchemaError(`Existing tables found for ${migration.id}; verify and adopt the baseline, or prepare a reviewed upgrade`);
      }
    }
    await runner.query(`CREATE TABLE IF NOT EXISTS public.idp_schema_migrations (
      id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
      adopted boolean NOT NULL DEFAULT false
    )`);
    for (const migration of pending) {
      if (!adopt) {
        for (const sql of migration.sql) await runner.query(sql);
        if (migration.tables.length && (await mismatchedTables(runner, migration)).length) throw new PlatformSchemaError(`Migration structure verification failed: ${migration.id}`);
      }
      await runner.query('INSERT INTO public.idp_schema_migrations (id, checksum, adopted) VALUES ($1, $2, $3)',
        [migration.id, migrationChecksum(migration), adopt]);
    }
    await runner.commitTransaction();
    return pending.map((migration) => migration.id);
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally { await runner.release(); }
};
