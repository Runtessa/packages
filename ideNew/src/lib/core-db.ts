import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Account } from '@idp/shared';
import { ModuleEntity } from '@idp/shared';
import { Secret } from '@idp/shared';
import { Tenant } from '@idp/shared';
import { UIPackage } from '@idp/shared';
import { ModuleRevision } from '@idp/shared';
import { UIPackageRevision } from '@idp/shared';
import { GlobalModuleEndpoint } from '@idp/shared';
import { GlobalModulePackage } from '@idp/shared';
import { GlobalModulePackageFile } from '@idp/shared';
import { GlobalUIPackage } from '@idp/shared';
import { GlobalUIPackageFile } from '@idp/shared';
import { OrmModel } from '@idp/shared';

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
    GlobalModuleEndpoint,
    GlobalModulePackage,
    GlobalModulePackageFile,
    GlobalUIPackage,
    GlobalUIPackageFile,
    ModuleRevision,
    UIPackageRevision,
    OrmModel,
  ],
} as DataSourceOptions;

export const CoreDataSource = new DataSource(baseOptions);

let initialized = false;
let initPromise: Promise<void> | null = null;
let schemaChecked = false;

export const ensureCoreSchema = async () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!CoreDataSource.isInitialized) {
      await CoreDataSource.initialize();
    }
    const allowSync =
      process.env.CORE_DB_SYNC === 'true' || process.env.NODE_ENV !== 'production';
    if (allowSync && !schemaChecked) {
      const queryRunner = CoreDataSource.createQueryRunner();
      try {
        const hasGlobalTable = await queryRunner.hasTable('global_ui_packages');
        const hasFileTable = await queryRunner.hasTable('global_ui_package_files');
        const hasDraftVersion =
          hasGlobalTable && (await queryRunner.hasColumn('global_ui_packages', 'draft_version'));
        const hasGlobalOwnerTeamId =
          hasGlobalTable && (await queryRunner.hasColumn('global_ui_packages', 'owner_team_id'));
        const hasGlobalEditorTeamIds =
          hasGlobalTable &&
          (await queryRunner.hasColumn('global_ui_packages', 'editor_team_ids'));
        const hasModuleTable = await queryRunner.hasTable('global_module_packages');
        const hasModuleFileTable = await queryRunner.hasTable('global_module_package_files');
        const hasModuleEndpointTable = await queryRunner.hasTable('global_module_endpoints');
        const hasModuleDraft =
          hasModuleTable &&
          (await queryRunner.hasColumn('global_module_packages', 'draft_version'));
        const hasModuleOwnerTeamId =
          hasModuleTable &&
          (await queryRunner.hasColumn('global_module_packages', 'owner_team_id'));
        const hasModuleEditorTeamIds =
          hasModuleTable &&
          (await queryRunner.hasColumn('global_module_packages', 'editor_team_ids'));
        const hasTenantTable = await queryRunner.hasTable('tenants');
        const hasAdapterAccess =
          hasTenantTable && (await queryRunner.hasColumn('tenants', 'adapterAccess'));
        const hasAdapterConfig =
          hasTenantTable && (await queryRunner.hasColumn('tenants', 'adapterConfig'));
        const hasAuthDbConfig =
          hasTenantTable && (await queryRunner.hasColumn('tenants', 'authDbConfig'));
        const hasAclPermissions =
          hasTenantTable && (await queryRunner.hasColumn('tenants', 'aclPermissions'));
        const hasAclRoles = hasTenantTable && (await queryRunner.hasColumn('tenants', 'aclRoles'));
        const hasAclEndpoints =
          hasTenantTable && (await queryRunner.hasColumn('tenants', 'aclEndpoints'));
        const hasOrmModels = await queryRunner.hasTable('orm_models');
        const hasAccountsTable = await queryRunner.hasTable('accounts');
        const hasAccountGroups =
          hasAccountsTable && (await queryRunner.hasColumn('accounts', 'groups'));
        if (
          !hasGlobalTable ||
          !hasFileTable ||
          !hasDraftVersion ||
          !hasGlobalOwnerTeamId ||
          !hasGlobalEditorTeamIds ||
          !hasModuleTable ||
          !hasModuleFileTable ||
          !hasModuleEndpointTable ||
          !hasModuleDraft ||
          !hasModuleOwnerTeamId ||
          !hasModuleEditorTeamIds ||
          !hasAdapterAccess ||
          !hasAdapterConfig ||
          !hasAuthDbConfig ||
          !hasAclPermissions ||
          !hasAclRoles ||
          !hasAclEndpoints ||
          !hasOrmModels ||
          !hasAccountGroups
        ) {
          await CoreDataSource.synchronize();
        }
      } finally {
        await queryRunner.release();
      }
      schemaChecked = true;
    }
    initialized = true;
    console.log(`Core Data Source has been initialized (${dbType})!`);
  })()
    .catch((err) => {
      initPromise = null;
      throw err;
    });

  return initPromise;
};

export const getCoreDataSource = () => CoreDataSource;
