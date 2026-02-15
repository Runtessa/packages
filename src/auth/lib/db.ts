import { AuthDataSource } from './typeorm/data-source';
import { runSqlMigrations } from './typeorm/migrations';

let initialized = false;

export const initDatabase = async (): Promise<void> => {
  if (!initialized) {
    await AuthDataSource.initialize();
    initialized = true;
  }
};

export const ensureDatabaseReady = async (): Promise<void> => {
  await initDatabase();
  await runSqlMigrations(AuthDataSource);
};

export const closeDatabase = async (): Promise<void> => {
  if (initialized && AuthDataSource.isInitialized) {
    await AuthDataSource.destroy();
    initialized = false;
  }
};

export { AuthDataSource };
