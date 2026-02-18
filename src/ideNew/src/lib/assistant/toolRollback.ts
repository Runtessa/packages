import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import {
  HttpMethod,
  ModuleEntity,
  Tenant,
  UIPackage,
  GlobalUIPackage,
  GlobalUIPackageFile,
  GlobalModulePackage,
  GlobalModulePackageFile,
  OrmModel,
} from '@idp/shared';
import { generateVersion } from '@/lib/version';
import { compileOrmSource } from '@/lib/orm-compiler';
import { rebuildTailwindPackagesForTenant, clearRegistryCache } from '@/lib/ui-entity-tailwind';
import {
  normalizeAclPermissionsValue,
  normalizeAclRolesValue,
  normalizeAclEndpointsValue,
} from './aclNormalization';
import { ensureAclEndpoint } from './workspaceOps';
import { isTailwindConfigName, isTailwindPackageName, shouldBuildTailwind, getTailwindPackageName } from '@/lib/tailwindBuilder';
import { removeTailwindPackage } from '@/lib/ui-entity-tailwind';
import { buildTailwindCssFromFiles, upsertGlobalTailwindPackage } from '@/lib/shared-tailwind';
import { buildSharedBundle } from './compiler';
import type { AssistantChange } from './types';
import type { AssistantToolContext } from './toolContext';

const cleanupTailwindPackages = async (tenantId: string) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const packages = await repo.find({ where: { tenant: { id: tenantId } } });
  const expected = new Set(
    packages
      .filter(
        (pkg) =>
          !isTailwindPackageName(pkg.name) &&
          !isTailwindConfigName(pkg.name) &&
          shouldBuildTailwind(pkg.fileExtension)
      )
      .map((pkg) => `${getTailwindPackageName(pkg.name)}::${pkg.version}`)
  );
  const tailwindPackages = packages.filter((pkg) => isTailwindPackageName(pkg.name));
  for (const pkg of tailwindPackages) {
    const key = `${pkg.name}::${pkg.version}`;
    if (expected.has(key)) continue;
    await removeTailwindPackage(tenantId, pkg.name, pkg.version);
  }
};

const updateSharedBundle = async (
  project: GlobalUIPackage | GlobalModulePackage,
  files: Array<GlobalUIPackageFile | GlobalModulePackageFile>
) => {
  const entryPath =
    project.entryPath ||
    (project.fileExtension === 'jsx' ? 'src/index.jsx' : 'src/index.js');
  const entryFile = files.find((file) => (file.path || '') === entryPath);
  const entrySource = entryFile?.content ?? '';
  const bundle = buildSharedBundle(
    { entryPath },
    files.map((file) => ({
      path: file.path ?? '',
      content: file.content ?? '',
      fileExtension: file.fileExtension ?? undefined,
    }))
  );
  project.code = entrySource;
  project.codeBlob = bundle;
  project.draftVersion = generateVersion();
  return project;
};

const rebuildSharedProject = async (
  projectId: string,
  projectKind: 'ui' | 'module'
) => {
  const projectRepo =
    projectKind === 'ui'
      ? CoreDataSource.getRepository(GlobalUIPackage)
      : CoreDataSource.getRepository(GlobalModulePackage);
  const fileRepo =
    projectKind === 'ui'
      ? CoreDataSource.getRepository(GlobalUIPackageFile)
      : CoreDataSource.getRepository(GlobalModulePackageFile);
  const project = await projectRepo.findOne({ where: { id: projectId } });
  if (!project) return;
  const files = await fileRepo.find({
    where: { project: { id: projectId } },
    order: { path: 'ASC' },
  });
  await updateSharedBundle(project as any, files as any);
  await projectRepo.save(project as any);
  if (
    projectKind === 'ui' &&
    shouldBuildTailwind(project.fileExtension) &&
    !isTailwindPackageName(project.name)
  ) {
    const css = await buildTailwindCssFromFiles(files as any);
    await upsertGlobalTailwindPackage(
      getTailwindPackageName(project.name),
      project.version,
      css
    );
  }
};

export const rollbackChanges = async (
  changes: AssistantChange[],
  ctx: AssistantToolContext
) => {
  await ensureCoreSchema();
  const moduleRepo = CoreDataSource.getRepository(ModuleEntity);
  const modelRepo = CoreDataSource.getRepository(OrmModel);
  const uiRepo = CoreDataSource.getRepository(UIPackage);
  const tenantRepo = CoreDataSource.getRepository(Tenant);
  const sharedUiRepo = CoreDataSource.getRepository(GlobalUIPackage);
  const sharedUiFileRepo = CoreDataSource.getRepository(GlobalUIPackageFile);
  const sharedModuleRepo = CoreDataSource.getRepository(GlobalModulePackage);
  const sharedModuleFileRepo = CoreDataSource.getRepository(GlobalModulePackageFile);
  let uiTouched = false;
  const sharedTouched = new Map<string, 'ui' | 'module'>();

  for (const change of [...changes].reverse()) {
    if (change.kind === 'module') {
      if (change.action === 'create' && change.after) {
        const mod = await moduleRepo.findOne({ where: { id: change.after.id } });
        if (mod) await moduleRepo.remove(mod);
      } else if (change.action === 'delete' && change.before) {
        const mod = moduleRepo.create({
          ...(change.before as any),
          tenant: ctx.tenant,
          draftVersion: generateVersion(),
        } as any) as unknown as ModuleEntity;
        await moduleRepo.save(mod);
        await ensureAclEndpoint(ctx.tenant, mod.routePath);
      } else if (change.action === 'update' && change.before) {
        const mod = await moduleRepo.findOne({ where: { id: change.before.id } });
        if (mod) {
          mod.routePath = change.before.routePath;
          mod.method = change.before.method as HttpMethod;
          mod.code = change.before.code;
          mod.fileExtension = change.before.fileExtension ?? mod.fileExtension;
          mod.draftVersion = generateVersion();
          await moduleRepo.save(mod);
          await ensureAclEndpoint(ctx.tenant, mod.routePath);
        }
      }
    }

    if (change.kind === 'ui') {
      uiTouched = true;
      if (change.action === 'create' && change.after) {
        const pkg = await uiRepo.findOne({ where: { id: change.after.id } });
        if (pkg) await uiRepo.remove(pkg);
      } else if (change.action === 'delete' && change.before) {
        const pkg = uiRepo.create({
          ...(change.before as any),
          tenant: ctx.tenant,
          draftVersion: generateVersion(),
        } as any) as unknown as UIPackage;
        await uiRepo.save(pkg);
        await clearRegistryCache(ctx.tenant.id, pkg.name, pkg.version);
      } else if (change.action === 'update' && change.before) {
        const pkg = await uiRepo.findOne({ where: { id: change.before.id } });
        if (pkg) {
          pkg.name = change.before.name;
          pkg.version = change.before.version;
          pkg.code = change.before.code;
          pkg.codeBlob = change.before.codeBlob;
          pkg.dependencies = change.before.dependencies;
          pkg.fileExtension = change.before.fileExtension ?? pkg.fileExtension;
          pkg.draftVersion = generateVersion();
          await uiRepo.save(pkg);
          await clearRegistryCache(ctx.tenant.id, pkg.name, pkg.version);
        }
      }
    }

    if (change.kind === 'model') {
      if (change.action === 'create' && change.after) {
        const model = await modelRepo.findOne({ where: { id: change.after.id } });
        if (model) await modelRepo.remove(model);
      } else if (change.action === 'delete' && change.before) {
        const code = change.before.code ?? '';
        const fileExtension = change.before.fileExtension ?? 'js';
        const restored = modelRepo.create({
          ...(change.before as any),
          tenant: ctx.tenant,
          codeBlob: compileOrmSource(code, fileExtension),
          draftVersion: generateVersion(),
        } as any) as unknown as OrmModel;
        await modelRepo.save(restored);
      } else if (change.action === 'update' && change.before) {
        const model = await modelRepo.findOne({ where: { id: change.before.id } });
        if (model) {
          const code = change.before.code ?? '';
          const fileExtension = change.before.fileExtension ?? 'js';
          model.path = change.before.path;
          model.code = code;
          model.codeBlob = compileOrmSource(code, fileExtension);
          model.fileExtension = fileExtension;
          model.draftVersion = generateVersion();
          await modelRepo.save(model);
        }
      }
    }

    if (change.kind === 'acl') {
      const tenant = await tenantRepo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) continue;
      if (change.file === 'permissions') {
        tenant.aclPermissions = normalizeAclPermissionsValue(change.before);
      } else if (change.file === 'roles') {
        tenant.aclRoles = normalizeAclRolesValue(change.before);
      } else {
        tenant.aclEndpoints = normalizeAclEndpointsValue(change.before);
      }
      await tenantRepo.save(tenant);
    }

    if (change.kind === 'shared-file') {
      sharedTouched.set(change.projectId, change.projectKind);
      const fileRepo =
        change.projectKind === 'ui' ? sharedUiFileRepo : sharedModuleFileRepo;
      const projectRepo =
        change.projectKind === 'ui' ? sharedUiRepo : sharedModuleRepo;
      if (change.action === 'create' && change.after) {
        const file = await fileRepo.findOne({ where: { id: change.after.id } });
        if (file) await fileRepo.remove(file);
      } else if (change.action === 'delete' && change.before) {
        const project = await projectRepo.findOne({
          where: { id: change.projectId },
        });
        if (!project) continue;
        const file = fileRepo.create({
          ...(change.before as any),
          project: project as any,
        } as any);
        await fileRepo.save(file);
      } else if (change.action === 'update' && change.before) {
        const file = await fileRepo.findOne({ where: { id: change.before.id } });
        if (file) {
          file.path = change.before.path;
          file.content = change.before.content;
          file.fileExtension = change.before.fileExtension ?? file.fileExtension;
          await fileRepo.save(file);
        }
      }
    }

    if (change.kind === 'shared-project') {
      const kind =
        change.after?.kind ?? change.before?.kind ?? 'ui';
      const projectRepo = kind === 'ui' ? sharedUiRepo : sharedModuleRepo;
      if (change.action === 'create' && change.after) {
        const project = await projectRepo.findOne({
          where: { id: change.after.id },
        });
        if (project) {
          await projectRepo.remove(project as any);
        }
      } else if (change.action === 'update' && change.before) {
        const project = await projectRepo.findOne({
          where: { id: change.before.id },
        });
        if (project) {
          (project as any).name = change.before.name;
          (project as any).version = change.before.version;
          (project as any).entryPath = change.before.entryPath;
          (project as any).code = change.before.code;
          (project as any).codeBlob = change.before.codeBlob;
          (project as any).dependencies = change.before.dependencies;
          (project as any).fileExtension =
            change.before.fileExtension ?? (project as any).fileExtension;
          (project as any).draftVersion = generateVersion();
          await projectRepo.save(project as any);
        }
      }
    }
  }
  if (uiTouched) {
    await rebuildTailwindPackagesForTenant(ctx.tenant.id);
    await cleanupTailwindPackages(ctx.tenant.id);
  }
  for (const [projectId, projectKind] of sharedTouched.entries()) {
    await rebuildSharedProject(projectId, projectKind);
  }
  return { ok: true };
};
