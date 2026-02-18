import {
  GlobalModulePackage,
  GlobalModulePackageFile,
  GlobalUIPackage,
  GlobalUIPackageFile,
  ModuleEntity,
  ModuleRevision,
  OrmModel,
  Tenant,
  UIPackage,
  UIPackageRevision,
} from '@idp/shared';
import { CoreDataSource } from '@/lib/core-db';
import {
  claimSharedProjectOwnershipIfNeeded,
  ensureSharedProjectEditable,
  getSharedProjectTeamAccess,
} from '@/lib/shared-project-access';
import type {
  ModuleSnapshot,
  OrmModelSnapshot,
  SharedFileSnapshot,
  SharedProjectSnapshot,
  UiSnapshot,
} from './types';
import { normalizeAclEndpointsValue } from './aclNormalization';
import { AssistantToolContext, toSharedAccessUser } from './toolContext';

export const ensureAclEndpoint = async (tenant: Tenant, routePath: string) => {
  const endpoints = normalizeAclEndpointsValue(tenant.aclEndpoints) as Record<
    string,
    { read?: string[]; write?: string[]; edit?: string[]; delete?: string[]; allowAnonymous?: boolean }
  >;
  if (endpoints[routePath]) return;
  endpoints[routePath] = {
    read: [],
    write: [],
    edit: [],
    delete: [],
    allowAnonymous: false,
  };
  tenant.aclEndpoints = endpoints as Tenant['aclEndpoints'];
  const tenantRepo = CoreDataSource.getRepository(Tenant);
  await tenantRepo.save(tenant);
};

export const snapshotModule = (mod: ModuleEntity): ModuleSnapshot => ({
  id: mod.id,
  routePath: mod.routePath,
  method: mod.method,
  code: mod.code ?? '',
  fileExtension: mod.fileExtension ?? undefined,
});

export const snapshotUi = (pkg: UIPackage): UiSnapshot => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  code: pkg.code ?? '',
  codeBlob: pkg.codeBlob ?? '',
  dependencies: pkg.dependencies ?? [],
  fileExtension: pkg.fileExtension ?? undefined,
});

export const snapshotModel = (model: OrmModel): OrmModelSnapshot => ({
  id: model.id,
  path: model.path ?? '',
  code: model.code ?? '',
  fileExtension: model.fileExtension ?? undefined,
  draftVersion: model.draftVersion ?? undefined,
});

export const snapshotSharedProject = (
  pkg: GlobalUIPackage | GlobalModulePackage,
  kind: 'ui' | 'module',
): SharedProjectSnapshot => {
  const access = getSharedProjectTeamAccess(pkg);
  return {
    id: pkg.id,
    name: pkg.name,
    version: pkg.version,
    entryPath: pkg.entryPath ?? (kind === 'ui' ? 'src/index.jsx' : 'src/index.js'),
    code: pkg.code ?? '',
    codeBlob: pkg.codeBlob ?? '',
    dependencies: pkg.dependencies ?? [],
    fileExtension: pkg.fileExtension ?? undefined,
    ownerTeamId: access.ownerTeamId ?? undefined,
    editorTeamIds: access.editorTeamIds,
    kind,
  };
};

export const snapshotSharedFile = (
  file: GlobalUIPackageFile | GlobalModulePackageFile,
): SharedFileSnapshot => ({
  id: file.id,
  path: file.path ?? '',
  content: file.content ?? '',
  fileExtension: file.fileExtension ?? undefined,
});

export const ensureSharedProjectWriteAccess = async (
  ctx: AssistantToolContext,
  projectRepo: any,
  project: GlobalUIPackage | GlobalModulePackage,
) => {
  const access = ensureSharedProjectEditable(toSharedAccessUser(ctx), project);
  const claimed = claimSharedProjectOwnershipIfNeeded(project, access);
  if (claimed) {
    await (projectRepo as any).save(project as any);
  }
};

export const createModuleRevision = async (
  mod: ModuleEntity,
  tenant: { id: string },
  userId: number,
  action: string,
) => {
  const revRepo = CoreDataSource.getRepository(ModuleRevision);
  const last = await revRepo.findOne({
    where: { module: { id: mod.id } },
    order: { revision: 'DESC' },
  });
  const revision = revRepo.create({
    module: mod,
    tenant: tenant as any,
    revision: (last?.revision ?? 0) + 1,
    routePath: mod.routePath,
    method: mod.method,
    code: mod.code,
    fileExtension: mod.fileExtension,
    action,
    createdBy: null,
  });
  await revRepo.save(revision);
  return revision;
};

export const createUiRevision = async (
  pkg: UIPackage,
  tenant: { id: string },
  userId: number,
  action: string,
) => {
  const revRepo = CoreDataSource.getRepository(UIPackageRevision);
  const last = await revRepo.findOne({
    where: { uiPackage: { id: pkg.id } },
    order: { revision: 'DESC' },
  });
  const revision = revRepo.create({
    uiPackage: pkg,
    tenant: tenant as any,
    revision: (last?.revision ?? 0) + 1,
    name: pkg.name,
    version: pkg.version,
    code: pkg.code,
    codeBlob: pkg.codeBlob,
    dependencies: pkg.dependencies ?? [],
    fileExtension: pkg.fileExtension,
    action,
    createdBy: null,
  });
  await revRepo.save(revision);
  return revision;
};

export const listWorkspace = async (
  tenant: Tenant,
  visibility: { includeSharedUi: boolean; includeSharedModules: boolean },
) => {
  const moduleRepo = CoreDataSource.getRepository(ModuleEntity);
  const uiRepo = CoreDataSource.getRepository(UIPackage);
  const modelRepo = CoreDataSource.getRepository(OrmModel);
  const sharedUiFileRepo = CoreDataSource.getRepository(GlobalUIPackageFile);
  const sharedModuleFileRepo = CoreDataSource.getRepository(GlobalModulePackageFile);
  const modules = await moduleRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { routePath: 'ASC', method: 'ASC' },
  });
  const uiPackages = await uiRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { name: 'ASC', version: 'DESC' },
  });
  const models = await modelRepo.find({
    where: { tenant: { id: tenant.id } },
    order: { path: 'ASC' },
  });
  const sharedUi = visibility.includeSharedUi
    ? await CoreDataSource.getRepository(GlobalUIPackage).find({ order: { name: 'ASC' } })
    : [];
  const sharedModules = visibility.includeSharedModules
    ? await CoreDataSource.getRepository(GlobalModulePackage).find({ order: { name: 'ASC' } })
    : [];
  const sharedUiFiles = visibility.includeSharedUi
    ? await sharedUiFileRepo.find({
        relations: { project: true },
        order: { path: 'ASC' },
      })
    : [];
  const sharedModuleFiles = visibility.includeSharedModules
    ? await sharedModuleFileRepo.find({
        relations: { project: true },
        order: { path: 'ASC' },
      })
    : [];
  return {
    tenant: {
      id: tenant.id,
      hostname: tenant.hostname,
      adapterAccess: tenant.adapterAccess ?? {},
      resourceConfig: tenant.resourceConfig ?? null,
      authDbConfig: tenant.authDbConfig ?? null,
    },
    modules: modules.map(snapshotModule),
    models: models.map(snapshotModel),
    uiPackages: uiPackages.map(snapshotUi),
    sharedUi: sharedUi.map((pkg) => snapshotSharedProject(pkg, 'ui')),
    sharedModules: sharedModules.map((pkg) => snapshotSharedProject(pkg, 'module')),
    sharedUiFiles: sharedUiFiles.map((file) => ({
      ...snapshotSharedFile(file),
      projectId: file.project?.id ?? '',
      projectName: file.project?.name ?? '',
    })),
    sharedModuleFiles: sharedModuleFiles.map((file) => ({
      ...snapshotSharedFile(file),
      projectId: file.project?.id ?? '',
      projectName: file.project?.name ?? '',
    })),
  };
};
