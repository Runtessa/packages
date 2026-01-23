import { ensureSchema, ensureAdminUser } from './db';
import { logger } from './logger';

const globalAny = globalThis as typeof globalThis & { __APP_INIT_PROMISE?: Promise<void> };

const globalInit =
  globalAny.__APP_INIT_PROMISE ||
  (globalAny.__APP_INIT_PROMISE = (async () => {
    await ensureSchema();
    await ensureAdminUser();
    await logger.info({
      source: 'init',
      action: 'app_init',
      message: 'Application initialized',
    });
  })());

export const ensureAppInitialized = () => globalInit;
