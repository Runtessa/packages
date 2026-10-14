import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { OrmModelSource } from './orm-loader';
import type { OrmMigrationInput } from './orm-migrate';

type Snapshot = { id: string; models: OrmModelSource[]; modelHash: string; targetHash: string; expectedPlanHash?: string };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const modelSnapshotHash = (models: OrmModelSource[]) => digest([...models].sort((a, b) => a.path.localeCompare(b.path)));

const connectionHash = (config: string | Record<string, unknown>) => {
  if (typeof config === 'string') {
    const url = new URL(config); return digest([url.hostname, url.port, url.pathname, url.searchParams.get('schema')]);
  }
  if (config.url) return connectionHash(String(config.url));
  return digest([config.host || 'localhost', config.port || 5432, config.database, config.schema || 'public']);
};

/** Additive DDL commits first. Until snapshot activation commits, Runtime keeps its prior compatible models. */
export async function activateModelSnapshot(input: {
  source: DataSource; tenantId: string; adapter: string; key: string; config: string | Record<string, unknown>;
  readModels: (manager: EntityManager) => Promise<OrmModelSource[]>; expectedPlanHash?: string; expectedModelHash?: string;
  migrate: (models: OrmModelSource[], adapter: string, config: string | Record<string, unknown>, options: any) => Promise<any>;
}) {
  if (input.adapter !== 'postgres') throw Object.assign(new Error('Production model activation currently requires PostgreSQL'), { statusCode: 400 });
  const adapterKey = `${input.adapter}:${input.key.trim().toLowerCase()}`;
  const runner = input.source.createQueryRunner(); let locked = false;
  await runner.connect();
  try {
    await runner.query("SET lock_timeout TO '10s'");
    await runner.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))', [input.tenantId, adapterKey]); locked = true;
    const models = await input.readModels(runner.manager);
    if (!models.length) throw Object.assign(new Error('No ORM models defined for tenant'), { statusCode: 400 });
    const modelHash = modelSnapshotHash(models), targetHash = connectionHash(input.config);
    if (input.expectedModelHash && input.expectedModelHash !== modelHash)
      throw Object.assign(new Error('Model drafts changed. Review the current schema plan.'), { statusCode: 409 });
    await runner.query('INSERT INTO runtessa_model_state (tenant_id, adapter_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [input.tenantId, adapterKey]);
    const [state] = await runner.query('SELECT * FROM runtessa_model_state WHERE tenant_id = $1 AND adapter_key = $2', [input.tenantId, adapterKey]);
    let snapshot: Snapshot | null = state.pending;
    let result: any;
    if (snapshot) {
      if (snapshot.targetHash !== targetHash) throw Object.assign(new Error('Adapter destination changed while activation was pending; reconcile the previous destination first'), { statusCode: 409 });
      const status = await input.migrate([], input.adapter, input.config,
        { action: 'status', operationId: snapshot.id, modelHash: snapshot.modelHash });
      if (status.applied) result = status.result;
      else if (snapshot.modelHash !== modelHash || snapshot.expectedPlanHash !== input.expectedPlanHash) snapshot = null;
    }
    if (!snapshot) {
      snapshot = { id: randomUUID(), models, modelHash, targetHash, expectedPlanHash: input.expectedPlanHash };
      await runner.query('UPDATE runtessa_model_state SET pending = $3 WHERE tenant_id = $1 AND adapter_key = $2', [input.tenantId, adapterKey, snapshot]);
    }
    if (!result) {
      try {
        result = await input.migrate(snapshot.models, input.adapter, input.config,
          { action: 'apply', expectedPlanHash: snapshot.expectedPlanHash, operationId: snapshot.id, modelHash: snapshot.modelHash });
      } catch (error) {
        // Reported validation/DDL errors completed rollback; unknown exits keep the durable operation for reconciliation.
        if ([400, 409, 500].includes(Number((error as any).statusCode)))
          await runner.query('UPDATE runtessa_model_state SET pending = NULL WHERE tenant_id = $1 AND adapter_key = $2', [input.tenantId, adapterKey]);
        throw error;
      }
    }
    await runner.startTransaction();
    const updated = await runner.query(`UPDATE runtessa_model_state SET active_models = $3, active_revision = $4,
      activated_at = now(), pending = NULL WHERE tenant_id = $1 AND adapter_key = $2 RETURNING active_revision`,
    [input.tenantId, adapterKey, JSON.stringify(snapshot.models), snapshot.id]);
    if (!updated.length) throw Object.assign(new Error('The tenant was removed before activation completed'), { statusCode: 409 });
    await runner.commitTransaction();
    return { ...result, activeRevision: snapshot.id, modelHash: snapshot.modelHash, pendingDraftChanges: modelHash !== snapshot.modelHash };
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    try {
      if (locked) await runner.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [input.tenantId, adapterKey]);
      await runner.query('RESET lock_timeout');
    } finally { await runner.release(); }
  }
}
