import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Account } from './entities/Account';
import { ModuleEntity } from './entities/Module';
import { Secret } from './entities/Secret';
import { Tenant } from './entities/Tenant';
import { UIPackage } from './entities/UIEntities';
import { ModuleRevision } from './entities/ModuleRevision';
import { UIPackageRevision } from './entities/UIPackageRevision';
import { GlobalUIPackage } from './entities/GlobalUIPackage';
import { GlobalUIPackageFile } from './entities/GlobalUIPackageFile';

const dbType = (process.env.CORE_DB_TYPE ||
  process.env.DB_TYPE ||
  'postgres') as DataSourceOptions['type'];
const dbName = process.env.CORE_DB_NAME || process.env.DB_NAME;
const normalizeDatabaseUrl = (rawUrl?: string, name?: string) => {
  if (!rawUrl || !name) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.pathname && parsed.pathname !== '/') {
      return rawUrl;
    }
    parsed.pathname = `/${name}`;
    return parsed.toString();
  } catch {
    return rawUrl;
  }
};
const databaseUrl = normalizeDatabaseUrl(
  process.env.CORE_DATABASE_URL || process.env.DATABASE_URL,
  dbName
);

const baseOptions = {
  type: dbType,
  url: databaseUrl,
  database: dbName,
  synchronize: process.env.CORE_DB_SYNC === 'true',
  logging: false,
  entities: [
    Tenant,
    Account,
    Secret,
    ModuleEntity,
    UIPackage,
    GlobalUIPackage,
    GlobalUIPackageFile,
    ModuleRevision,
    UIPackageRevision,
  ],
} as DataSourceOptions;

export const CoreDataSource = new DataSource(baseOptions);

let initialized = false;

export const ensureCoreSchema = async () => {
  if (!initialized) {
    await CoreDataSource.initialize();
    const allowSync =
      process.env.CORE_DB_SYNC === 'true' || process.env.NODE_ENV !== 'production';
    if (allowSync) {
      const queryRunner = CoreDataSource.createQueryRunner();
      try {
        const hasGlobalTable = await queryRunner.hasTable('global_ui_packages');
        const hasFileTable = await queryRunner.hasTable('global_ui_package_files');
        if (!hasGlobalTable || !hasFileTable) {
          await CoreDataSource.synchronize();
        }
      } finally {
        await queryRunner.release();
      }
    }
    initialized = true;
    console.log(`Core Data Source has been initialized (${dbType})!`);
  }
};

export const getCoreDataSource = () => CoreDataSource;
