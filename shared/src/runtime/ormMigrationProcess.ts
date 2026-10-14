import 'reflect-metadata';
import { serveRestrictedProcess } from './process-channel';
import { migrateOrmSchema } from './orm-migrate';

serveRestrictedProcess(migrateOrmSchema);
