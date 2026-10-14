import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { loadDynamicOrmEntities, type OrmModelSource } from './orm-loader';
import { schemaPlan } from './orm-migration-policy';
import { planSchemaOnRunner } from './orm-schema-plan';

export type OrmMigrationInput = {
  models: OrmModelSource[]; adapter: 'postgres' | 'mysql' | 'mssql';
  config: string | Record<string, unknown>; action?: 'plan' | 'apply'; expectedPlanHash?: string;
};

export async function migrateOrmSchema({ models, adapter, config, action = 'apply', expectedPlanHash }: OrmMigrationInput) {
  if (!['postgres', 'mysql', 'mssql'].includes(adapter)) throw new Error('Unsupported migration adapter');
  if (!['plan', 'apply'].includes(action)) throw Object.assign(new Error('Invalid migration action'), { statusCode: 400 });
  let entities: any[];
  try {
    ({ entities } = loadDynamicOrmEntities(models));
    if (!entities.length) throw new Error('No valid TypeORM entities found');
  } catch (error) {
    throw Object.assign(new Error(`Failed to load ORM entities: ${(error as Error).message}`), { statusCode: 400 });
  }
  const source = new DataSource({
    ...(typeof config === 'string' ? { url: config } : config),
    type: adapter, entities, synchronize: false, dropSchema: false, migrationsRun: false,
    migrations: [], subscribers: [], installExtensions: false, cache: false, logging: false,
  } as any);
  const runner = source.createQueryRunner();
  let mysqlLock = false;
  try {
    await source.initialize();
    await runner.connect();
    await runner.startTransaction();
    if (adapter === 'postgres') {
      await runner.query("SET LOCAL lock_timeout TO '10s'");
      await runner.query("SET LOCAL statement_timeout TO '20s'");
      await runner.query('SELECT pg_advisory_xact_lock(1048832, 1)');
    } else if (adapter === 'mysql') {
      const result = await runner.query("SELECT GET_LOCK(CONCAT('runtessa:orm:', LEFT(SHA2(DATABASE(), 256), 48)), 10) AS acquired");
      if (Number(result[0]?.acquired) !== 1) throw Object.assign(new Error('Another schema update is running'), { statusCode: 409 });
      mysqlLock = true;
    } else {
      await runner.query("DECLARE @result int; EXEC @result = sp_getapplock @Resource = 'runtessa:orm', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000; IF @result < 0 THROW 51000, 'Another schema update is running', 1;");
    }
    const { upQueries } = await planSchemaOnRunner(source, runner);
    const queries = upQueries.map(({ query, parameters }) => ({ query, parameters: parameters ?? [] }));
    // Driver initialization must not install extensions before the reviewed plan.
    if (adapter === 'postgres' && source.entityMetadatas.some((entity) => entity.generatedColumns.some((column) => column.generationStrategy === 'uuid'))) {
      const extension = (source.options as any).uuidExtension ?? 'uuid-ossp';
      if (!['uuid-ossp', 'pgcrypto'].includes(extension)) throw new Error('Unsupported UUID extension');
      const installed = await runner.query('SELECT 1 FROM pg_extension WHERE extname = $1', [extension]);
      if (!installed.length) queries.unshift({ query: `CREATE EXTENSION IF NOT EXISTS "${extension}"`, parameters: [] });
    }
    const plan = schemaPlan(queries);
    if (action === 'plan') {
      await runner.rollbackTransaction();
      return { ok: true, entities: entities.length, applied: false, transactional: adapter !== 'mysql', plan };
    }
    if (!plan.safe) throw Object.assign(new Error('Schema update would remove or change existing structures. Review the migration plan; no schema statements were applied.'), { statusCode: 409 });
    if (expectedPlanHash && expectedPlanHash !== plan.hash) throw Object.assign(new Error('The schema plan changed. Review the current plan before applying it.'), { statusCode: 409 });
    for (const statement of plan.statements) await runner.query(statement.query, statement.parameters);
    if (adapter === 'postgres' && plan.statements.length) {
      await runner.query('CREATE TABLE IF NOT EXISTS "runtessa_model_migrations" (id uuid PRIMARY KEY, plan_hash text NOT NULL, statement_count integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      await runner.query('INSERT INTO "runtessa_model_migrations" (id, plan_hash, statement_count) VALUES ($1, $2, $3)', [randomUUID(), plan.hash, plan.statements.length]);
    }
    await runner.commitTransaction();
    return { ok: true, entities: entities.length, applied: true, transactional: adapter !== 'mysql', plan };
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    if (mysqlLock) await runner.query("SELECT RELEASE_LOCK(CONCAT('runtessa:orm:', LEFT(SHA2(DATABASE(), 256), 48)))").catch(() => undefined);
    await runner.release();
    if (source.isInitialized) await source.destroy();
  }
}
