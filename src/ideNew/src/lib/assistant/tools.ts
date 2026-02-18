import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
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
import redis from '@/lib/redis';
import { generateVersion } from '@/lib/version';
import {
  buildTailwindCss,
  ensureTailwindDependency,
  getTailwindPackageName,
  isTailwindConfigName,
  isTailwindPackageName,
  shouldBuildTailwind,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import {
  loadTailwindConfigForTenant,
  removeTailwindPackage,
  upsertTailwindPackage,
  clearRegistryCache,
} from '@/lib/ui-entity-tailwind';
import {
  buildTailwindCssFromFiles,
  upsertGlobalTailwindPackage,
} from '@/lib/shared-tailwind';
import { compileUiSource } from './compiler';
import { compileOrmSource } from '@/lib/orm-compiler';
import {
  assertToolPermission,
  hasToolPermission,
  normalizeMethod,
  normalizeRoute,
  normalizeCode,
  normalizeUiName,
  normalizeUiVersion,
  normalizeDependencies,
  normalizeOwnerTeamId,
  normalizeTeamIdList,
  type AssistantToolContext,
} from './toolContext';
import {
  assertBackendModuleContract,
  assertDashboardEntrypointCode,
  assertNoMockData,
  assertNonDashboardDoesNotDefineAppEntrypoint,
  assertOrmModelDecoratorNotation,
  assertUiCodeIsRuntimeSafe,
  DASHBOARD_UI_NAME,
} from './codeContracts';
import {
  normalizeModuleExtension,
  normalizeModelPath,
  normalizeModelExtension,
  normalizeUiExtension,
  normalizeSharedPath,
  normalizeSharedProjectVersion,
  normalizeSharedExtension,
} from './fileNormalizers';
import {
  normalizeAclPermissionsValue,
  normalizeAclRolesValue,
  normalizeAclEndpointsValue,
} from './aclNormalization';
import {
  createModuleRevision,
  createUiRevision,
  ensureAclEndpoint,
  ensureSharedProjectWriteAccess,
  listWorkspace,
  snapshotModel,
  snapshotModule,
  snapshotSharedFile,
  snapshotSharedProject,
  snapshotUi,
} from './workspaceOps';
import {
  createSharedProjectInternal,
  ensureDashboardEntrypoint,
  rollbackChanges,
  updateUiPackage,
} from './toolOperations';
import { buildModuleModelTools } from './toolModuleModelTools';
import { buildAclSharedTools } from './toolAclSharedTools';

export const buildAssistantTools = (ctx: AssistantToolContext) => {
  const listWorkspaceTool = createTool({
    id: 'list_workspace',
    description:
      'List backend modules, ORM models, UI packages, and shared project files available to the current tenant.',
    execute: async () => {
      await ensureCoreSchema();
      return await listWorkspace(ctx.tenant, {
        includeSharedUi: hasToolPermission(ctx, 'ide.shared_ui.read'),
        includeSharedModules: hasToolPermission(ctx, 'ide.shared_modules.read'),
      });
    },
  });
  const moduleModelTools = buildModuleModelTools(ctx);
  const getModuleTool = moduleModelTools.get_module;
  const createModuleTool = moduleModelTools.create_module;
  const updateModuleTool = moduleModelTools.update_module;
  const deleteModuleTool = moduleModelTools.delete_module;
  const listModelsTool = moduleModelTools.list_models;
  const getModelTool = moduleModelTools.get_model;
  const createModelTool = moduleModelTools.create_model;
  const updateModelTool = moduleModelTools.update_model;
  const deleteModelTool = moduleModelTools.delete_model;

  const listUiTool = createTool({
    id: 'list_ui_packages',
    description: 'List UI packages for the current tenant.',
    execute: async () => {
      assertToolPermission(ctx, 'ide.ui.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(UIPackage);
      const packages = await repo.find({
        where: { tenant: { id: ctx.tenant.id } },
        order: { name: 'ASC', version: 'DESC' },
      });
      return packages.map(snapshotUi).filter((pkg) => !isTailwindPackageName(pkg.name));
    },
  });

  const getUiTool = createTool({
    id: 'get_ui_package',
    description: 'Fetch a UI package by id or name/version.',
    inputSchema: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      version: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.ui.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(UIPackage);
      let pkg: UIPackage | null = null;
      if (input.id) {
        pkg = await repo.findOne({
          where: { id: input.id, tenant: { id: ctx.tenant.id } },
        });
      } else if (input.name && input.version) {
        pkg = await repo.findOne({
          where: {
            tenant: { id: ctx.tenant.id },
            name: normalizeUiName(input.name),
            version: normalizeUiVersion(input.version),
          },
        });
      } else if (input.name) {
        // Version-less read should return the latest package for the requested name.
        pkg = await repo.findOne({
          where: {
            tenant: { id: ctx.tenant.id },
            name: normalizeUiName(input.name),
          },
          order: { createdAt: 'DESC' },
        });
      } else {
        throw new Error('Provide id or name (optionally with version)');
      }
      if (!pkg) throw new Error('UI package not found');
      return snapshotUi(pkg);
    },
  });

  const createUiTool = createTool({
    id: 'create_ui_package',
    description: 'Create a new UI package.',
    inputSchema: z.object({
      name: z.string(),
      version: z.string(),
      code: z.string(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.ui.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(UIPackage);
      const name = normalizeUiName(input.name);
      const version = normalizeUiVersion(input.version);
      const code = normalizeCode(input.code);
      assertUiCodeIsRuntimeSafe(code);
      assertDashboardEntrypointCode(name, code);
      assertNonDashboardDoesNotDefineAppEntrypoint(name, code);
      if (name !== DASHBOARD_UI_NAME) {
        await ensureDashboardEntrypoint(ctx);
      }
      const fileExtension = normalizeUiExtension(input.fileExtension);
      const depsRaw = normalizeDependencies(input.dependencies);
      const existing = await repo.findOne({
        where: { tenant: { id: ctx.tenant.id }, name, version },
      });
      if (existing) throw new Error('UI package already exists');
      const usesTailwind =
        shouldBuildTailwind(fileExtension) && !isTailwindConfigName(name);
      const tailwindName = getTailwindPackageName(name);
      const deps = usesTailwind
        ? ensureTailwindDependency(depsRaw, tailwindName)
        : stripTailwindDependency(depsRaw, tailwindName);
      const compiled = compileUiSource(code, fileExtension);
      const pkg = repo.create({
        tenant: ctx.tenant,
        name,
        version,
        code,
        codeBlob: compiled,
        dependencies: deps,
        fileExtension,
        draftVersion: generateVersion(),
      });
      await repo.save(pkg);
      if (usesTailwind) {
        const tailwindConfig = await loadTailwindConfigForTenant(ctx.tenant.id);
        const css = await buildTailwindCss(code, fileExtension, tailwindConfig ?? undefined);
        await upsertTailwindPackage(ctx.tenant.id, tailwindName, version, css);
      }
      await clearRegistryCache(ctx.tenant.id, name, version);
      ctx.changes.push({ kind: 'ui', action: 'create', after: snapshotUi(pkg) });
      return snapshotUi(pkg);
    },
  });

  const updateUiTool = createTool({
    id: 'update_ui_package',
    description: 'Update a UI package by id or name/version.',
    inputSchema: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      version: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.ui.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(UIPackage);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            name: normalizeUiName(input.name),
            version: normalizeUiVersion(input.version),
          };
      const pkg = await repo.findOne({ where });
      if (!pkg) throw new Error('UI package not found');
      const targetName = input.name ? normalizeUiName(input.name) : pkg.name;
      if (targetName !== DASHBOARD_UI_NAME) {
        await ensureDashboardEntrypoint(ctx);
      }
      const before = snapshotUi(pkg);
      await updateUiPackage(ctx, pkg, {
        name: input.name,
        version: input.version,
        code: input.code,
        fileExtension: input.fileExtension,
        dependencies: input.dependencies,
      });
      ctx.changes.push({
        kind: 'ui',
        action: 'update',
        before,
        after: snapshotUi(pkg),
      });
      return snapshotUi(pkg);
    },
  });

  const deleteUiTool = createTool({
    id: 'delete_ui_package',
    description: 'Delete a UI package by id or name/version.',
    inputSchema: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      version: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.ui.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(UIPackage);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            name: normalizeUiName(input.name),
            version: normalizeUiVersion(input.version),
          };
      const pkg = await repo.findOne({ where });
      if (!pkg) throw new Error('UI package not found');
      if (pkg.name === DASHBOARD_UI_NAME) {
        throw new Error('Cannot delete "@app/dashboard". It is the required UI entrypoint.');
      }
      const before = snapshotUi(pkg);
      await createUiRevision(pkg, ctx.tenant, ctx.userId, 'delete');
      const encoded = encodeURIComponent(pkg.name);
      await redis.del(
        `registry:tenant:${ctx.tenant.id}:${encoded}:latest`,
        `registry:tenant:${ctx.tenant.id}:${encoded}:${pkg.version}`
      );
      const tailwindName = getTailwindPackageName(pkg.name);
      await removeTailwindPackage(ctx.tenant.id, tailwindName, pkg.version);
      await repo.remove(pkg);
      ctx.changes.push({ kind: 'ui', action: 'delete', before });
      return { ok: true };
    },
  });

  const aclSharedTools = buildAclSharedTools(ctx);
  const getAclTool = aclSharedTools.get_acl_config;
  const updateAclTool = aclSharedTools.update_acl_file;
  const listSharedUiTool = aclSharedTools.list_shared_ui_projects;
  const listSharedModuleTool = aclSharedTools.list_shared_module_projects;
  const createSharedUiProjectTool = aclSharedTools.create_shared_ui_project;
  const createSharedModuleProjectTool = aclSharedTools.create_shared_module_project;
  const getSharedFileTool = aclSharedTools.get_shared_file;
  const writeSharedFileTool = aclSharedTools.write_shared_file;
  const deleteSharedFileTool = aclSharedTools.delete_shared_file;

  return {
    list_workspace: listWorkspaceTool,
    get_module: getModuleTool,
    create_module: createModuleTool,
    update_module: updateModuleTool,
    delete_module: deleteModuleTool,
    list_models: listModelsTool,
    get_model: getModelTool,
    create_model: createModelTool,
    update_model: updateModelTool,
    delete_model: deleteModelTool,
    list_ui_packages: listUiTool,
    get_ui_package: getUiTool,
    create_ui_package: createUiTool,
    update_ui_package: updateUiTool,
    delete_ui_package: deleteUiTool,
    get_acl_config: getAclTool,
    update_acl_file: updateAclTool,
    list_shared_ui_projects: listSharedUiTool,
    list_shared_module_projects: listSharedModuleTool,
    create_shared_ui_project: createSharedUiProjectTool,
    create_shared_module_project: createSharedModuleProjectTool,
    get_shared_file: getSharedFileTool,
    write_shared_file: writeSharedFileTool,
    delete_shared_file: deleteSharedFileTool,
  };
};

export { rollbackChanges };
