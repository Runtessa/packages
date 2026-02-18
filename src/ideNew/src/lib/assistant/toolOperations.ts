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
  rebuildTailwindPackagesForTenant,
  removeTailwindPackage,
  upsertTailwindPackage,
  clearRegistryCache,
} from '@/lib/ui-entity-tailwind';
import {
  buildTailwindCssFromFiles,
  upsertGlobalTailwindPackage,
} from '@/lib/shared-tailwind';
import { applySharedProjectTeamAccess } from '@/lib/shared-project-access';
import { buildSharedBundle, compileUiSource } from './compiler';
import { compileOrmSource } from '@/lib/orm-compiler';
import {
  hasToolPermission,
  normalizeCode,
  normalizeUiName,
  normalizeUiVersion,
  normalizeDependencies,
  normalizeOwnerTeamId,
  normalizeTeamIdList,
  type AssistantToolContext,
} from './toolContext';
import {
  assertDashboardEntrypointCode,
  assertNoMockData,
  assertNonDashboardDoesNotDefineAppEntrypoint,
  assertOrmModelDecoratorNotation,
  assertUiCodeIsRuntimeSafe,
  DASHBOARD_UI_NAME,
} from './codeContracts';
import {
  normalizeModelExtension,
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
  snapshotModel,
  snapshotModule,
  snapshotSharedFile,
  snapshotSharedProject,
  snapshotUi,
} from './workspaceOps';
import type { AssistantChange } from './types';

const DASHBOARD_DEFAULT_VERSION = '1.0.0';
const DEFAULT_DASHBOARD_CODE = `import React from 'react';
import { useApiClient } from '@app/datacontext';

export function App() {
  const apiClient = useApiClient();
  void apiClient;
  return (
    <div style={{ padding: 24 }}>
      <h1>IDP Dashboard</h1>
    </div>
  );
}
`;
const DEFAULT_SHARED_UI_ENTRY_PATH = 'src/index.jsx';
const DEFAULT_SHARED_MODULE_ENTRY_PATH = 'src/index.js';
const DEFAULT_SHARED_UI_CODE = `import React from 'react';

export default function SharedUiComponent() {
  return null;
}
`;
const DEFAULT_SHARED_MODULE_CODE = `module.exports = {};
`;

export const updateUiPackage = async (
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
  assertUiCodeIsRuntimeSafe(nextCode);
  assertDashboardEntrypointCode(nextName, nextCode);
  assertNonDashboardDoesNotDefineAppEntrypoint(nextName, nextCode);
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

export const ensureDashboardEntrypoint = async (ctx: AssistantToolContext) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const existing = await repo.findOne({
    where: { tenant: { id: ctx.tenant.id }, name: DASHBOARD_UI_NAME },
    order: { createdAt: 'DESC' },
  });
  if (existing) return existing;

  const compiled = compileUiSource(DEFAULT_DASHBOARD_CODE, 'jsx');
  const dashboard = repo.create({
    tenant: ctx.tenant,
    name: DASHBOARD_UI_NAME,
    version: DASHBOARD_DEFAULT_VERSION,
    code: DEFAULT_DASHBOARD_CODE,
    codeBlob: compiled,
    dependencies: [],
    fileExtension: 'jsx',
    draftVersion: generateVersion(),
  });
  await repo.save(dashboard);
  await clearRegistryCache(ctx.tenant.id, dashboard.name, dashboard.version);
  ctx.changes.push({ kind: 'ui', action: 'create', after: snapshotUi(dashboard) });
  return dashboard;
};

export const updateSharedBundle = async (
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

export const createSharedProjectInternal = async (
  ctx: AssistantToolContext,
  input: {
    kind: 'ui' | 'module';
    name: string;
    version: string;
    entryPath?: string;
    code?: string;
    fileExtension?: string;
    dependencies?: string[];
    ownerTeamId?: number | null;
    editorTeamIds?: number[];
  },
  options?: { skipChangeTrack?: boolean }
) => {
  const projectRepo =
    input.kind === 'ui'
      ? CoreDataSource.getRepository(GlobalUIPackage)
      : CoreDataSource.getRepository(GlobalModulePackage);
  const fileRepo =
    input.kind === 'ui'
      ? CoreDataSource.getRepository(GlobalUIPackageFile)
      : CoreDataSource.getRepository(GlobalModulePackageFile);

  const name = normalizeUiName(input.name);
  const version = normalizeSharedProjectVersion(input.version);
  const existing = await projectRepo.findOne({ where: { name, version } });
  if (existing) {
    throw new Error(`Shared ${input.kind} project already exists for ${name}@${version}`);
  }

  const defaultEntryPath =
    input.kind === 'ui' ? DEFAULT_SHARED_UI_ENTRY_PATH : DEFAULT_SHARED_MODULE_ENTRY_PATH;
  const entryPath = input.entryPath
    ? normalizeSharedPath(input.entryPath)
    : defaultEntryPath;
  const fileExtension = normalizeSharedExtension(
    entryPath,
    input.fileExtension ?? (input.kind === 'ui' ? 'jsx' : 'js')
  );
  const code = normalizeCode(
    input.code,
    input.kind === 'ui' ? DEFAULT_SHARED_UI_CODE : DEFAULT_SHARED_MODULE_CODE
  );
  if (input.kind === 'ui') {
    assertUiCodeIsRuntimeSafe(code);
  } else {
    assertNoMockData(code, 'Shared backend code');
  }
  const dependencies = normalizeDependencies(input.dependencies);
  const requestedOwnerTeamId = normalizeOwnerTeamId(input.ownerTeamId);
  const requestedEditorTeamIds = normalizeTeamIdList(input.editorTeamIds);
  const fallbackOwnerTeamId =
    Number.isInteger(Number(ctx.activeTeamId)) && Number(ctx.activeTeamId) > 0
      ? Number(ctx.activeTeamId)
      : null;
  if (
    !ctx.isAdmin &&
    requestedOwnerTeamId &&
    requestedOwnerTeamId !== fallbackOwnerTeamId
  ) {
    throw new Error('Forbidden: non-admin users can only set ownerTeamId to active team');
  }
  const ownerTeamId = requestedOwnerTeamId ?? fallbackOwnerTeamId;
  if (!ownerTeamId && !ctx.isAdmin) {
    throw new Error('ownerTeamId is required when active team is not set');
  }
  const allowEditorAssignments = hasToolPermission(ctx, 'ide.tenants.manage');

  const project = projectRepo.create({
    name,
    version,
    entryPath,
    code: '',
    codeBlob: '',
    dependencies,
    fileExtension,
    draftVersion: generateVersion(),
    ownerTeamId: null,
    editorTeamIds: [],
  } as any);
  applySharedProjectTeamAccess(
    project as any,
    ownerTeamId,
    allowEditorAssignments ? requestedEditorTeamIds : []
  );
  await projectRepo.save(project as any);

  const entryFile = fileRepo.create({
    project: project as any,
    path: entryPath,
    content: code,
    fileExtension,
  } as any);
  await fileRepo.save(entryFile as any);

  const files = await fileRepo.find({
    where: { project: { id: (project as any).id } },
    order: { path: 'ASC' },
  });
  await updateSharedBundle(project as any, files as any);
  await projectRepo.save(project as any);

  if (
    input.kind === 'ui' &&
    shouldBuildTailwind((project as any).fileExtension) &&
    !isTailwindPackageName((project as any).name)
  ) {
    const css = await buildTailwindCssFromFiles(files as any);
    await upsertGlobalTailwindPackage(
      getTailwindPackageName((project as any).name),
      (project as any).version,
      css
    );
  }

  if (!options?.skipChangeTrack) {
    ctx.changes.push({
      kind: 'shared-project',
      action: 'create',
      after: snapshotSharedProject(project as any, input.kind),
    });
    ctx.changes.push({
      kind: 'shared-file',
      action: 'create',
      projectId: (project as any).id,
      projectKind: input.kind,
      after: snapshotSharedFile(entryFile as any),
    });
  }

  return {
    project: project as any,
    entryFile: entryFile as any,
  };
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

export { rollbackChanges } from './toolRollback';
