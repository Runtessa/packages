import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import {
  HttpMethod,
  ModuleEntity,
  ModuleRevision,
  Tenant,
  UIPackage,
  UIPackageRevision,
  GlobalUIPackage,
  GlobalUIPackageFile,
  GlobalModulePackage,
  GlobalModulePackageFile,
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
  rebuildTailwindPackagesForTenant,
  removeTailwindPackage,
  upsertTailwindPackage,
  clearRegistryCache,
} from '@/lib/ui-entity-tailwind';
import {
  buildTailwindCssFromFiles,
  upsertGlobalTailwindPackage,
} from '@/lib/shared-tailwind';
import { buildSharedBundle, compileUiSource } from './compiler';
import type {
  AssistantChange,
  ModuleSnapshot,
  UiSnapshot,
  SharedProjectSnapshot,
  SharedFileSnapshot,
} from './types';

type AssistantToolContext = {
  tenant: Tenant;
  userId: number;
  isAdmin: boolean;
  changes: AssistantChange[];
};

const normalizeMethod = (raw: unknown): HttpMethod => {
  if (typeof raw !== 'string') throw new Error('method is required');
  const upper = raw.toUpperCase();
  if (!Object.values(HttpMethod).includes(upper as HttpMethod)) {
    throw new Error('Invalid HTTP method');
  }
  return upper as HttpMethod;
};

const normalizeRoute = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('routePath is required');
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const normalizeCode = (raw: unknown, fallback = ''): string => {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'string') throw new Error('code must be a string');
  return raw;
};

const normalizeUiName = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('name is required');
  return raw.trim();
};

const normalizeUiVersion = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('version is required');
  return raw.trim();
};

const normalizeDependencies = (raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('dependencies must be an array');
  return raw.map((item) => String(item));
};

const normalizeModuleExtension = (raw: unknown): string => {
  const allowed = new Set(['ts', 'js', 'jsx', 'tsx']);
  if (!raw || typeof raw !== 'string') return 'ts';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'ts';
};

const normalizeUiExtension = (raw: unknown): string => {
  const allowed = new Set(['tsx', 'jsx', 'ts', 'js', 'json', 'css']);
  if (!raw || typeof raw !== 'string') return 'tsx';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'tsx';
};

const normalizeSharedPath = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('path is required');
  return raw.trim().replace(/\\/g, '/');
};

const normalizeSharedExtension = (path: string, raw?: unknown): string => {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.replace(/^\./, '').toLowerCase();
  }
  const ext = path.split('.').pop();
  return ext ? ext.toLowerCase() : 'tsx';
};

const ensureAclEndpoint = async (tenant: Tenant, routePath: string) => {
  const endpoints = (tenant.aclEndpoints ?? {}) as Record<
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

const snapshotModule = (mod: ModuleEntity): ModuleSnapshot => ({
  id: mod.id,
  routePath: mod.routePath,
  method: mod.method,
  code: mod.code ?? '',
  fileExtension: mod.fileExtension ?? undefined,
});

const snapshotUi = (pkg: UIPackage): UiSnapshot => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  code: pkg.code ?? '',
  codeBlob: pkg.codeBlob ?? '',
  dependencies: pkg.dependencies ?? [],
  fileExtension: pkg.fileExtension ?? undefined,
});

const snapshotSharedProject = (
  pkg: GlobalUIPackage | GlobalModulePackage,
  kind: 'ui' | 'module'
): SharedProjectSnapshot => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  entryPath: pkg.entryPath ?? 'src/index.ts',
  code: pkg.code ?? '',
  codeBlob: pkg.codeBlob ?? '',
  dependencies: pkg.dependencies ?? [],
  fileExtension: pkg.fileExtension ?? undefined,
  kind,
});

const snapshotSharedFile = (file: GlobalUIPackageFile | GlobalModulePackageFile): SharedFileSnapshot => ({
  id: file.id,
  path: file.path ?? '',
  content: file.content ?? '',
  fileExtension: file.fileExtension ?? undefined,
});

const createModuleRevision = async (
  mod: ModuleEntity,
  tenant: { id: string },
  userId: number,
  action: string
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

const createUiRevision = async (
  pkg: UIPackage,
  tenant: { id: string },
  userId: number,
  action: string
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

const listWorkspace = async (tenantId: string, isAdmin: boolean) => {
  const moduleRepo = CoreDataSource.getRepository(ModuleEntity);
  const uiRepo = CoreDataSource.getRepository(UIPackage);
  const modules = await moduleRepo.find({
    where: { tenant: { id: tenantId } },
    order: { routePath: 'ASC', method: 'ASC' },
  });
  const uiPackages = await uiRepo.find({
    where: { tenant: { id: tenantId } },
    order: { name: 'ASC', version: 'DESC' },
  });
  const sharedUi = isAdmin
    ? await CoreDataSource.getRepository(GlobalUIPackage).find({ order: { name: 'ASC' } })
    : [];
  const sharedModules = isAdmin
    ? await CoreDataSource.getRepository(GlobalModulePackage).find({ order: { name: 'ASC' } })
    : [];
  return {
    modules: modules.map(snapshotModule),
    uiPackages: uiPackages.map(snapshotUi),
    sharedUi: sharedUi.map((pkg) => snapshotSharedProject(pkg, 'ui')),
    sharedModules: sharedModules.map((pkg) => snapshotSharedProject(pkg, 'module')),
  };
};

const updateUiPackage = async (
  ctx: AssistantToolContext,
  pkg: UIPackage,
  nextValues: Partial<{
    name: string;
    version: string;
    code: string;
    codeBlob: string;
    dependencies: string[];
    fileExtension: string;
  }>
) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const nextName = nextValues.name ?? pkg.name;
  const nextVersion = nextValues.version ?? pkg.version;
  const nextExt = nextValues.fileExtension ?? pkg.fileExtension;
  const nextCode = nextValues.code ?? pkg.code ?? '';
  const compiled =
    nextValues.codeBlob ?? compileUiSource(nextCode, nextExt ?? undefined);
  const rawDeps = nextValues.dependencies ?? pkg.dependencies ?? [];

  const usesTailwind =
    shouldBuildTailwind(nextExt ?? undefined) && !isTailwindConfigName(nextName);
  const nextTailwindName = getTailwindPackageName(nextName);
  const previousTailwindName = getTailwindPackageName(pkg.name);
  const depsSansTailwind = stripTailwindDependency(
    stripTailwindDependency(rawDeps, previousTailwindName),
    nextTailwindName
  );
  const nextDeps = usesTailwind
    ? ensureTailwindDependency(depsSansTailwind, nextTailwindName)
    : depsSansTailwind;
  const tailwindConfig = usesTailwind
    ? await loadTailwindConfigForTenant(ctx.tenant.id)
    : null;
  const tailwindCss = usesTailwind
    ? await buildTailwindCss(nextCode, nextExt ?? undefined, tailwindConfig ?? undefined)
    : '';

  if (nextName !== pkg.name || nextVersion !== pkg.version) {
    const duplicate = await repo.findOne({
      where: { tenant: { id: ctx.tenant.id }, name: nextName, version: nextVersion },
    });
    if (duplicate && duplicate.id !== pkg.id) {
      throw new Error('Another UI entity already uses this name/version');
    }
  }

  await createUiRevision(pkg, ctx.tenant, ctx.userId, 'update');

  pkg.name = nextName;
  pkg.version = nextVersion;
  pkg.code = nextCode;
  pkg.codeBlob = compiled;
  pkg.dependencies = nextDeps;
  pkg.fileExtension = nextExt;
  pkg.draftVersion = generateVersion();
  await repo.save(pkg);
  await clearRegistryCache(ctx.tenant.id, pkg.name, pkg.version);

  if (!usesTailwind) {
    await removeTailwindPackage(ctx.tenant.id, previousTailwindName, pkg.version);
  } else {
    if (previousTailwindName !== nextTailwindName || pkg.version !== nextVersion) {
      await removeTailwindPackage(ctx.tenant.id, previousTailwindName, pkg.version);
    }
    await upsertTailwindPackage(ctx.tenant.id, nextTailwindName, nextVersion, tailwindCss);
  }
  if (isTailwindConfigName(nextName) || isTailwindConfigName(pkg.name)) {
    await rebuildTailwindPackagesForTenant(ctx.tenant.id);
  }

  return pkg;
};

const updateSharedBundle = async (
  project: GlobalUIPackage | GlobalModulePackage,
  files: Array<GlobalUIPackageFile | GlobalModulePackageFile>
) => {
  const entryPath = project.entryPath || 'src/index.ts';
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

export const buildAssistantTools = (ctx: AssistantToolContext) => {
  const listWorkspaceTool = createTool({
    id: 'list_workspace',
    description: 'List modules, UI packages, and shared projects available to the current tenant.',
    execute: async () => {
      await ensureCoreSchema();
      return await listWorkspace(ctx.tenant.id, ctx.isAdmin);
    },
  });

  const getModuleTool = createTool({
    id: 'get_module',
    description: 'Fetch a backend module by id or by route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
    }),
    execute: async (input) => {
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          };
      const mod = await repo.findOne({ where });
      if (!mod) throw new Error('Module not found');
      return snapshotModule(mod);
    },
  });

  const createModuleTool = createTool({
    id: 'create_module',
    description: 'Create a new backend module (route + method + code).',
    inputSchema: z.object({
      routePath: z.string(),
      method: z.string(),
      code: z.string(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const routePath = normalizeRoute(input.routePath);
      const method = normalizeMethod(input.method);
      const code = normalizeCode(input.code);
      const fileExtension = normalizeModuleExtension(input.fileExtension);
      const existing = await repo.findOne({
        where: { tenant: { id: ctx.tenant.id }, routePath, method },
      });
      if (existing) throw new Error('Module already exists for route/method');
      const mod = repo.create({
        tenant: ctx.tenant,
        routePath,
        method,
        code,
        fileExtension,
        draftVersion: generateVersion(),
      });
      await repo.save(mod);
      await ensureAclEndpoint(ctx.tenant, routePath);
      ctx.changes.push({ kind: 'module', action: 'create', after: snapshotModule(mod) });
      return snapshotModule(mod);
    },
  });

  const updateModuleTool = createTool({
    id: 'update_module',
    description: 'Update an existing backend module by id or by route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          };
      const mod = await repo.findOne({ where });
      if (!mod) throw new Error('Module not found');
      const before = snapshotModule(mod);
      const nextRoute = input.routePath ? normalizeRoute(input.routePath) : mod.routePath;
      const nextMethod = input.method ? normalizeMethod(input.method) : mod.method;
      const nextCode = input.code !== undefined ? normalizeCode(input.code) : mod.code;
      const nextExt =
        input.fileExtension !== undefined
          ? normalizeModuleExtension(input.fileExtension)
          : mod.fileExtension;
      if (nextRoute !== mod.routePath || nextMethod !== mod.method) {
        const duplicate = await repo.findOne({
          where: { tenant: { id: ctx.tenant.id }, routePath: nextRoute, method: nextMethod },
        });
        if (duplicate && duplicate.id !== mod.id) {
          throw new Error('Another module already uses this route/method');
        }
      }
      await createModuleRevision(mod, ctx.tenant, ctx.userId, 'update');
      mod.routePath = nextRoute;
      mod.method = nextMethod;
      mod.code = nextCode;
      mod.fileExtension = nextExt;
      mod.draftVersion = generateVersion();
      await repo.save(mod);
      await ensureAclEndpoint(ctx.tenant, nextRoute);
      ctx.changes.push({
        kind: 'module',
        action: 'update',
        before,
        after: snapshotModule(mod),
      });
      return snapshotModule(mod);
    },
  });

  const deleteModuleTool = createTool({
    id: 'delete_module',
    description: 'Delete a backend module by id or route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
    }),
    execute: async (input) => {
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          };
      const mod = await repo.findOne({ where });
      if (!mod) throw new Error('Module not found');
      const before = snapshotModule(mod);
      await createModuleRevision(mod, ctx.tenant, ctx.userId, 'delete');
      await repo.remove(mod);
      ctx.changes.push({ kind: 'module', action: 'delete', before });
      return { ok: true };
    },
  });

  const listUiTool = createTool({
    id: 'list_ui_packages',
    description: 'List UI packages for the current tenant.',
    execute: async () => {
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
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(UIPackage);
      const name = normalizeUiName(input.name);
      const version = normalizeUiVersion(input.version);
      const code = normalizeCode(input.code);
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

  const getAclTool = createTool({
    id: 'get_acl_config',
    description: 'Fetch ACL permissions, roles, and endpoints for the tenant.',
    execute: async () => {
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(Tenant);
      const tenant = await repo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) throw new Error('Tenant not found');
      return {
        permissions: tenant.aclPermissions ?? { permissions: [] },
        roles: tenant.aclRoles ?? { roles: {}, groups: {} },
        endpoints: tenant.aclEndpoints ?? {},
      };
    },
  });

  const updateAclTool = createTool({
    id: 'update_acl_file',
    description: 'Update an ACL JSON file (permissions, roles, or endpoints).',
    inputSchema: z.object({
      file: z.enum(['permissions', 'roles', 'endpoints']),
      content: z.any(),
    }),
    execute: async (input) => {
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(Tenant);
      const tenant = await repo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) throw new Error('Tenant not found');
      const before =
        input.file === 'permissions'
          ? tenant.aclPermissions ?? { permissions: [] }
          : input.file === 'roles'
          ? tenant.aclRoles ?? { roles: {}, groups: {} }
          : tenant.aclEndpoints ?? {};
      if (input.file === 'permissions') {
        tenant.aclPermissions = input.content as Tenant['aclPermissions'];
      } else if (input.file === 'roles') {
        tenant.aclRoles = input.content as Tenant['aclRoles'];
      } else {
        tenant.aclEndpoints = input.content as Tenant['aclEndpoints'];
      }
      await repo.save(tenant);
      ctx.changes.push({
        kind: 'acl',
        action: 'update',
        file: input.file,
        before,
        after: input.content,
      });
      return { ok: true };
    },
  });

  const listSharedUiTool = createTool({
    id: 'list_shared_ui_projects',
    description: 'List shared UI projects (admin only).',
    execute: async () => {
      if (!ctx.isAdmin) throw new Error('Admin privileges required');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(GlobalUIPackage);
      const projects = await repo.find({ order: { name: 'ASC', version: 'DESC' } });
      return projects.map((pkg) => snapshotSharedProject(pkg, 'ui'));
    },
  });

  const listSharedModuleTool = createTool({
    id: 'list_shared_module_projects',
    description: 'List shared backend projects (admin only).',
    execute: async () => {
      if (!ctx.isAdmin) throw new Error('Admin privileges required');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(GlobalModulePackage);
      const projects = await repo.find({ order: { name: 'ASC', version: 'DESC' } });
      return projects.map((pkg) => snapshotSharedProject(pkg, 'module'));
    },
  });

  const getSharedFileTool = createTool({
    id: 'get_shared_file',
    description: 'Fetch a shared project file (admin only).',
    inputSchema: z.object({
      projectId: z.string(),
      fileId: z.string().optional(),
      path: z.string().optional(),
      projectKind: z.enum(['ui', 'module']),
    }),
    execute: async (input) => {
      if (!ctx.isAdmin) throw new Error('Admin privileges required');
      await ensureCoreSchema();
      const repo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);
      const where = input.fileId
        ? { id: input.fileId }
        : { project: { id: input.projectId }, path: normalizeSharedPath(input.path) };
      const file = await repo.findOne({ where });
      if (!file) throw new Error('Shared file not found');
      return snapshotSharedFile(file);
    },
  });

  const writeSharedFileTool = createTool({
    id: 'write_shared_file',
    description: 'Create or update a shared project file (admin only).',
    inputSchema: z.object({
      projectId: z.string(),
      projectKind: z.enum(['ui', 'module']),
      path: z.string(),
      content: z.string(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      if (!ctx.isAdmin) throw new Error('Admin privileges required');
      await ensureCoreSchema();
      const projectRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackage)
          : CoreDataSource.getRepository(GlobalModulePackage);
      const fileRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);
      const project = await projectRepo.findOne({ where: { id: input.projectId } });
      if (!project) throw new Error('Shared project not found');
      const normalizedPath = normalizeSharedPath(input.path);
      let file = await fileRepo.findOne({
        where: { project: { id: input.projectId }, path: normalizedPath },
      });
      const before = file ? snapshotSharedFile(file) : null;
      const nextExt = normalizeSharedExtension(normalizedPath, input.fileExtension);
      if (!file) {
        file = fileRepo.create({
          project: project as any,
          path: normalizedPath,
          content: input.content,
          fileExtension: nextExt,
        });
      } else {
        file.path = normalizedPath;
        file.content = input.content;
        file.fileExtension = nextExt;
      }
      await fileRepo.save(file);

      const files = await fileRepo.find({
        where: { project: { id: input.projectId } },
        order: { path: 'ASC' },
      });
      await updateSharedBundle(project as any, files as any);
      await projectRepo.save(project as any);

      if (
        input.projectKind === 'ui' &&
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

      ctx.changes.push({
        kind: 'shared-file',
        action: before ? 'update' : 'create',
        projectId: input.projectId,
        projectKind: input.projectKind,
        before,
        after: snapshotSharedFile(file),
      });
      return snapshotSharedFile(file);
    },
  });

  const deleteSharedFileTool = createTool({
    id: 'delete_shared_file',
    description: 'Delete a shared project file (admin only).',
    inputSchema: z.object({
      projectId: z.string(),
      projectKind: z.enum(['ui', 'module']),
      fileId: z.string().optional(),
      path: z.string().optional(),
    }),
    execute: async (input) => {
      if (!ctx.isAdmin) throw new Error('Admin privileges required');
      await ensureCoreSchema();
      const projectRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackage)
          : CoreDataSource.getRepository(GlobalModulePackage);
      const fileRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);
      const project = await projectRepo.findOne({ where: { id: input.projectId } });
      if (!project) throw new Error('Shared project not found');
      const where = input.fileId
        ? { id: input.fileId }
        : { project: { id: input.projectId }, path: normalizeSharedPath(input.path) };
      const file = await fileRepo.findOne({ where });
      if (!file) throw new Error('Shared file not found');
      const before = snapshotSharedFile(file);
      await fileRepo.remove(file);
      const files = await fileRepo.find({
        where: { project: { id: input.projectId } },
        order: { path: 'ASC' },
      });
      await updateSharedBundle(project as any, files as any);
      await projectRepo.save(project as any);
      if (
        input.projectKind === 'ui' &&
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
      ctx.changes.push({
        kind: 'shared-file',
        action: 'delete',
        projectId: input.projectId,
        projectKind: input.projectKind,
        before,
      });
      return { ok: true };
    },
  });

  return {
    list_workspace: listWorkspaceTool,
    get_module: getModuleTool,
    create_module: createModuleTool,
    update_module: updateModuleTool,
    delete_module: deleteModuleTool,
    list_ui_packages: listUiTool,
    get_ui_package: getUiTool,
    create_ui_package: createUiTool,
    update_ui_package: updateUiTool,
    delete_ui_package: deleteUiTool,
    get_acl_config: getAclTool,
    update_acl_file: updateAclTool,
    list_shared_ui_projects: listSharedUiTool,
    list_shared_module_projects: listSharedModuleTool,
    get_shared_file: getSharedFileTool,
    write_shared_file: writeSharedFileTool,
    delete_shared_file: deleteSharedFileTool,
  };
};

export const rollbackChanges = async (
  changes: AssistantChange[],
  ctx: AssistantToolContext
) => {
  await ensureCoreSchema();
  const moduleRepo = CoreDataSource.getRepository(ModuleEntity);
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
          ...change.before,
          tenant: ctx.tenant,
          draftVersion: generateVersion(),
        });
        await moduleRepo.save(mod);
        await ensureAclEndpoint(ctx.tenant, mod.routePath);
      } else if (change.action === 'update' && change.before) {
        const mod = await moduleRepo.findOne({ where: { id: change.before.id } });
        if (mod) {
          mod.routePath = change.before.routePath;
          mod.method = change.before.method as HttpMethod;
          mod.code = change.before.code;
          mod.fileExtension = change.before.fileExtension ?? undefined;
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
          ...change.before,
          tenant: ctx.tenant,
          draftVersion: generateVersion(),
        });
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
          pkg.fileExtension = change.before.fileExtension ?? undefined;
          pkg.draftVersion = generateVersion();
          await uiRepo.save(pkg);
          await clearRegistryCache(ctx.tenant.id, pkg.name, pkg.version);
        }
      }
    }

    if (change.kind === 'acl') {
      const tenant = await tenantRepo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) continue;
      if (change.file === 'permissions') {
        tenant.aclPermissions = change.before as Tenant['aclPermissions'];
      } else if (change.file === 'roles') {
        tenant.aclRoles = change.before as Tenant['aclRoles'];
      } else {
        tenant.aclEndpoints = change.before as Tenant['aclEndpoints'];
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
          ...change.before,
          project: project as any,
        });
        await fileRepo.save(file);
      } else if (change.action === 'update' && change.before) {
        const file = await fileRepo.findOne({ where: { id: change.before.id } });
        if (file) {
          file.path = change.before.path;
          file.content = change.before.content;
          file.fileExtension = change.before.fileExtension ?? undefined;
          await fileRepo.save(file);
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
