import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Account } from './entities/Account';
import { ModuleEntity } from './entities/Module';
import { Secret } from './entities/Secret';
import { Tenant } from './entities/Tenant';
import { UIPackage } from './entities/UIEntities';

const dbType = (process.env.CORE_DB_TYPE ||
  process.env.DB_TYPE ||
  'postgres') as DataSourceOptions['type'];

const baseOptions = {
  type: dbType,
  url: process.env.CORE_DATABASE_URL || process.env.DATABASE_URL,
  database: process.env.CORE_DB_NAME || process.env.DB_NAME,
  synchronize: false,
  logging: false,
  entities: [Tenant, Account, Secret, ModuleEntity, UIPackage],
} as DataSourceOptions;

export const CoreDataSource = new DataSource(baseOptions);

let initialized = false;

export const ensureCoreSchema = async () => {
  if (!initialized) {
    await CoreDataSource.initialize();
    initialized = true;
    console.log(`Core Data Source has been initialized (${dbType})!`);
  }
};

export const getCoreDataSource = () => CoreDataSource;
