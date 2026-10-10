import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { platformConnectionOptions } from './connection-options';
import { coreEntities } from './entities';
import { platformMigrations, migrationChecksum } from './migration-registry';
import { pendingMigrations, PlatformSchemaError, readMigrationHistory } from './migration-history';
import { runPlatformMigrations } from './migrate';
import { safeErrorMeta } from '../logging/safe-error';
import type { PlatformSchema } from './migration-types';

export const databaseCommand = async (args: string[]): Promise<void> => {
  const command = args[0];
  if (!['status', 'plan', 'diff', 'migrate', 'adopt'].includes(command)) {
    throw new PlatformSchemaError('Use: <status|plan|diff|migrate|adopt> --target <core|ide|catalog|ide-core> [--env-file <path>]');
  }
  let target = 'core', envFile: string | undefined;
  for (let index = 1; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!value || !['--target', '--env-file'].includes(args[index])) throw new PlatformSchemaError('Invalid database command arguments');
    if (args[index] === '--target') target = value; else envFile = value;
  }
  if (!['core', 'ide', 'catalog', 'ide-core'].includes(target)) throw new PlatformSchemaError('Invalid database migration target');
  if (envFile) process.loadEnvFile(envFile);
  const schema = (target === 'ide-core' ? 'core' : target) as PlatformSchema;
  const options = target === 'ide-core'
    ? { ...platformConnectionOptions('catalog'), entities: coreEntities }
    : platformConnectionOptions(schema);
  const namedUrl = options.url && new URL(options.url).pathname.replace(/^\//, '');
  if (!options.database && !namedUrl) throw new PlatformSchemaError('Explicit database name required; configure the selected connection before running a database command');
  const source = new DataSource(options);
  try {
    await source.initialize();
    if (command === 'migrate' || command === 'adopt') {
      const applied = await runPlatformMigrations(source, schema, command === 'adopt');
      console.log(JSON.stringify({ target, command, applied }));
      return;
    }
    const runner = source.createQueryRunner();
    try {
      const history = await readMigrationHistory(runner);
      const migrations = platformMigrations(schema);
      const pending = new Set(pendingMigrations(history, migrations).map((migration) => migration.id));
      console.log(JSON.stringify({ target, migrations: migrations.map((migration) => ({
        id: migration.id, checksum: migrationChecksum(migration), applied: !pending.has(migration.id),
      })) }, null, 2));
      if (command === 'plan') for (const migration of migrations) if (pending.has(migration.id)) {
        console.log(`-- ${migration.id}: review existing tables before applying this baseline`);
        for (const sql of migration.sql) console.log(sql + ';');
      }
      if (command === 'diff') {
        const queries = (await source.driver.createSchemaBuilder().log()).upQueries;
        console.log('-- Suggested differences only. Review destructive operations; this command executes no DDL.');
        for (const query of queries) console.log(query.query + ';');
      }
    } finally { await runner.release(); }
  } finally { if (source.isInitialized) await source.destroy(); }
};

if (require.main === module) void databaseCommand(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof PlatformSchemaError ? error.message : 'Database command failed; check connectivity and permissions');
  if (!(error instanceof PlatformSchemaError)) console.error(JSON.stringify(safeErrorMeta(error)));
  process.exitCode = 1;
});
