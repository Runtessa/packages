import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { serveRestrictedProcess } from './process-channel';
import { loadDynamicOrmEntities } from './orm-loader';

serveRestrictedProcess(async ({ models, adapter, config }) => {
  if (!['postgres', 'mysql', 'mssql'].includes(adapter)) throw new Error('Unsupported migration adapter');
  let entities: any[];
  try {
    ({ entities } = loadDynamicOrmEntities(models));
    if (!entities.length) throw new Error('No valid TypeORM entities found');
  } catch (error) {
    throw Object.assign(new Error(`Failed to load ORM entities: ${(error as Error).message}`), { statusCode: 400 });
  }
  const dataSource = new DataSource({
    ...(typeof config === 'string' ? { url: config } : config),
    type: adapter, entities, synchronize: false, logging: false,
  });
  try {
    await dataSource.initialize();
    await dataSource.synchronize();
    return { ok: true, entities: entities.length };
  } finally { if (dataSource.isInitialized) await dataSource.destroy(); }
});
