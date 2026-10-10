import type { DataSource } from 'typeorm';
import { platformMigrations } from './migration-registry';
import { pendingMigrations, PlatformSchemaError, readMigrationHistory } from './migration-history';
import type { PlatformSchema } from './migration-types';

export const assertPlatformSchema = async (source: DataSource, schema: PlatformSchema): Promise<void> => {
  const runner = source.createQueryRunner();
  try {
    const pending = pendingMigrations(await readMigrationHistory(runner), platformMigrations(schema));
    if (pending.length) throw new PlatformSchemaError(`Platform migrations pending for ${schema}; run db:migrate or verify and adopt the existing baseline`);
  } finally { await runner.release(); }
};

const initialized = new WeakMap<DataSource, { promise: Promise<DataSource>; completed: boolean }>();
export const initializePlatformDataSource = (source: DataSource, schema: PlatformSchema): Promise<DataSource> => {
  const previous = initialized.get(source);
  if (previous && (!previous.completed || source.isInitialized)) return previous.promise;
  const state = { promise: Promise.resolve(source), completed: false };
  state.promise = (async () => {
    const owned = !source.isInitialized;
    try {
      if (owned) await source.initialize();
      await assertPlatformSchema(source, schema);
      state.completed = true;
      return source;
    } catch (error) {
      if (owned && source.isInitialized) await source.destroy().catch(() => {});
      initialized.delete(source);
      throw error;
    }
  })();
  initialized.set(source, state);
  return state.promise;
};
