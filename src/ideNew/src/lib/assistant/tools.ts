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
import {
  applySharedProjectTeamAccess,
  claimSharedProjectOwnershipIfNeeded,
  ensureSharedProjectEditable,
  getSharedProjectTeamAccess,
} from '@/lib/shared-project-access';
import { buildSharedBundle, compileUiSource } from './compiler';
import { compileOrmSource } from '@/lib/orm-compiler';
import { hasIdePermission, type IdePermission } from '@/lib/rbac';
import type {
  AssistantChange,
  ModuleSnapshot,
  OrmModelSnapshot,
  UiSnapshot,
  SharedProjectSnapshot,
  SharedFileSnapshot,
} from './types';

type AssistantToolContext = {
  tenant: Tenant;
  userId: number;
  role: string;
  permissions: IdePermission[];
  isAdmin: boolean;
  activeTeamId?: number | null;
  changes: AssistantChange[];
};

const hasToolPermission = (ctx: AssistantToolContext, permission: IdePermission) => {
  if (ctx.isAdmin) return true;
  if (Array.isArray(ctx.permissions) && ctx.permissions.includes(permission)) return true;
  return hasIdePermission(ctx.role, permission);
};

const assertToolPermission = (ctx: AssistantToolContext, permission: IdePermission) => {
  if (hasToolPermission(ctx, permission)) return;
  throw new Error(`Forbidden: missing permission ${permission}`);
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

const normalizeOwnerTeamId = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('ownerTeamId must be a positive integer');
  }
  return value;
};

const normalizeTeamIdList = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
};

const toSharedAccessUser = (ctx: AssistantToolContext) => ({
  isAdmin: ctx.isAdmin,
  role: ctx.role,
  normalizedRole: ctx.role,
  permissions: ctx.permissions,
  activeTeamId: ctx.activeTeamId ?? null,
});

const DASHBOARD_UI_NAME = '@app/dashboard';
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
const SHARED_PROJECT_DEFAULT_VERSION = '1.0.0';
const DEFAULT_SHARED_UI_ENTRY_PATH = 'src/index.jsx';
const DEFAULT_SHARED_MODULE_ENTRY_PATH = 'src/index.js';
const DEFAULT_SHARED_UI_CODE = `import React from 'react';

export default function SharedUiComponent() {
  return null;
}
`;
const DEFAULT_SHARED_MODULE_CODE = `module.exports = {};
`;

const UI_FORBIDDEN_IMPORTS = ['@app/runtime', 'typeorm'];
const MODULE_FORBIDDEN_IMPORTS = ['adapters'];
const KERNEL_API_CLIENT_MODULE = '@app/datacontext';
const MOCK_DATA_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bmock\s*data\b/i, label: 'mock data' },
  { pattern: /\bdummy\s*data\b/i, label: 'dummy data' },
  { pattern: /\bfake\s*data\b/i, label: 'fake data' },
  { pattern: /\bsample\s*data\b/i, label: 'sample data' },
  { pattern: /\bplaceholder\s*data\b/i, label: 'placeholder data' },
  { pattern: /\bTODO\b[^\n]*\bmock\b/i, label: 'TODO mock marker' },
  { pattern: /\bFIXME\b[^\n]*\bmock\b/i, label: 'FIXME mock marker' },
];

const assertNoMockData = (code: string, scopeLabel: string) => {
  for (const entry of MOCK_DATA_PATTERNS) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `${scopeLabel} must not include ${entry.label}. No mock data is allowed; build a real full-stack flow (backend + models + ACL + UI).`
      );
    }
  }
};

const hasKernelClientImport = (code: string) =>
  /from\s+['"]@app\/datacontext['"]/m.test(code) ||
  /require\(\s*['"]@app\/datacontext['"]\s*\)/m.test(code);

const hasKernelClientUsage = (code: string) =>
  /\buseApiClient\s*\(/m.test(code) || /\bgetApiClient\s*\(/m.test(code);

const assertUiCodeIsRuntimeSafe = (code: string) => {
  assertNoMockData(code, 'UI code');
  for (const specifier of UI_FORBIDDEN_IMPORTS) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importPattern = new RegExp(
      `(?:import\\s+[^;]*?from\\s+['"]${escaped}['"]|require\\(\\s*['"]${escaped}['"]\\s*\\))`,
      'm'
    );
    if (importPattern.test(code)) {
      throw new Error(
        `UI packages cannot import "${specifier}". Use backend modules for adapters/ORM logic and call API endpoints from UI.`
      );
    }
  }
  const directNetworkPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bfetch\s*\(/m, label: 'fetch(...)' },
    { pattern: /\baxios\b/m, label: 'axios' },
    { pattern: /\bXMLHttpRequest\b/m, label: 'XMLHttpRequest' },
  ];
  for (const entry of directNetworkPatterns) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `UI packages must use the kernel API client from "${KERNEL_API_CLIENT_MODULE}". Direct network usage (${entry.label}) is not allowed.`
      );
    }
  }
  const mentionsApiPath = /(['"`])\/api\/[^'"`\s]+/m.test(code);
  if (mentionsApiPath) {
    if (!hasKernelClientImport(code) || !hasKernelClientUsage(code)) {
      throw new Error(
        `UI packages that call /api/* must import and use "${KERNEL_API_CLIENT_MODULE}" (useApiClient/getApiClient).`
      );
    }
  }
};

const assertBackendModuleContract = (code: string) => {
  assertNoMockData(code, 'Backend module code');
  for (const specifier of MODULE_FORBIDDEN_IMPORTS) {
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importPattern = new RegExp(
      `(?:import\\s+[^;]*?from\\s+['"]${escaped}['"]|require\\(\\s*['"]${escaped}['"]\\s*\\))`,
      'm'
    );
    if (importPattern.test(code)) {
      throw new Error(
        `Backend modules must not import "${specifier}". Use the injected adapters argument: module.exports = async function handler(req, adapters) { ... }.`
      );
    }
  }
  const directDbAdapterPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\badapters\.postgres\b/m, label: 'adapters.postgres' },
    { pattern: /\badapters\.mysql\b/m, label: 'adapters.mysql' },
    { pattern: /\badapters\.mssql\b/m, label: 'adapters.mssql' },
  ];
  for (const entry of directDbAdapterPatterns) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `Direct DB adapter usage (${entry.label}) is not allowed in backend modules. Use adapters.orm('<adapter:key>') only.`
      );
    }
  }
  const directDbLibraryPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /require\(\s*['"]pg['"]\s*\)/m, label: 'pg' },
    { pattern: /require\(\s*['"]mysql2?['"]\s*\)/m, label: 'mysql/mysql2' },
    { pattern: /require\(\s*['"]mssql['"]\s*\)/m, label: 'mssql' },
    { pattern: /require\(\s*['"]typeorm['"]\s*\)/m, label: 'typeorm' },
    { pattern: /from\s+['"]pg['"]/m, label: 'pg' },
    { pattern: /from\s+['"]mysql2?['"]/m, label: 'mysql/mysql2' },
    { pattern: /from\s+['"]mssql['"]/m, label: 'mssql' },
    { pattern: /from\s+['"]typeorm['"]/m, label: 'typeorm' },
  ];
  for (const entry of directDbLibraryPatterns) {
    if (entry.pattern.test(code)) {
      throw new Error(
        `Direct DB library import (${entry.label}) is not allowed in backend modules. Use adapters.orm('<adapter:key>') only.`
      );
    }
  }
  if (!/module\.exports\s*=/m.test(code)) {
    throw new Error(
      'Backend module must export a CommonJS handler via module.exports = async function handler(req, adapters) { ... }.'
    );
  }
  if (!/\(\s*req\s*,\s*adapters\s*\)/m.test(code)) {
    throw new Error('Backend module handler must accept (req, adapters) parameters.');
  }

  const ormCallPattern = /\badapters\.orm\s*\(([^)]*)\)/g;
  let ormCallMatch: RegExpExecArray | null = ormCallPattern.exec(code);
  while (ormCallMatch) {
    const argRaw = String(ormCallMatch[1] ?? '').trim();
    const stringLiteral = argRaw.match(/^['"]([^'"]+)['"]$/);
    if (!stringLiteral?.[1]) {
      throw new Error(
        'Backend modules must call adapters.orm with a string key in "<database>:<key>" format (example: await adapters.orm("postgres:pga1")).'
      );
    }
    const ormKey = stringLiteral[1].trim();
    if (!ormKey.includes(':')) {
      throw new Error(
        `Invalid adapters.orm key "${ormKey}". Use "<database>:<key>" format (example: "postgres:pga1").`
      );
    }
    if (/^pga\d+$/i.test(ormKey)) {
      throw new Error(
        `Invalid adapters.orm key "${ormKey}". Bare keys are not allowed; use "<database>:<key>" (example: "postgres:${ormKey}").`
      );
    }
    const before = code.slice(Math.max(0, ormCallMatch.index - 48), ormCallMatch.index);
    if (!/\bawait\s*$/m.test(before)) {
      throw new Error(
        'adapters.orm(...) must be awaited. Use "await adapters.orm(\'<database>:<key>\')" before using repository/dataSource.'
      );
    }
    ormCallMatch = ormCallPattern.exec(code);
  }
};

const assertDashboardEntrypointCode = (name: string, code: string) => {
  if (name !== DASHBOARD_UI_NAME) return;
  if (!/export\s+function\s+App\s*\(/m.test(code)) {
    throw new Error(
      'Entrypoint UI package "@app/dashboard" must export a named function App().'
    );
  }
  if (/export\s+default\s+/m.test(code)) {
    throw new Error(
      'Entrypoint UI package "@app/dashboard" cannot use default export. Use "export function App()".'
    );
  }
  if (!hasKernelClientImport(code) || !hasKernelClientUsage(code)) {
    throw new Error(
      `Entrypoint UI package "${DASHBOARD_UI_NAME}" must import and use "${KERNEL_API_CLIENT_MODULE}" (useApiClient/getApiClient).`
    );
  }
};

const assertNonDashboardDoesNotDefineAppEntrypoint = (name: string, code: string) => {
  if (name === DASHBOARD_UI_NAME) return;
  if (
    /export\s+function\s+App\s*\(/m.test(code) ||
    /export\s+default\s+function\s+App\s*\(/m.test(code)
  ) {
    throw new Error(
      'Only "@app/dashboard" may define/export App(). Create reusable components in other packages and import them into @app/dashboard.'
    );
  }
};

const normalizeModuleExtension = (raw: unknown): string => {
  const allowed = new Set(['js']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'js';
};

const ensureModelPath = (value: string) => {
  const extMatch = value.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${value}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return value.replace(/\.[^.\/]+$/, '.js');
  }
  return value;
};

const normalizeModelPath = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('path is required');
  }
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  return ensureModelPath(trimmed);
};

const normalizeModelExtension = (raw: unknown): string => {
  const allowed = new Set(['js']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error('Only .js model files are supported.');
  }
  return normalized;
};

const assertOrmModelDecoratorNotation = (code: string) => {
  assertNoMockData(code, 'ORM model code');
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error('Model code cannot be empty.');
  }
  if (/^[\[{]/.test(trimmed)) {
    throw new Error(
      'Model must be JavaScript class code with TypeORM decorators, not JSON.'
    );
  }
  if (!/@Entity\s*\(/m.test(code)) {
    throw new Error('Model must include @Entity(...) decorator.');
  }
  if (!/\bclass\s+[A-Za-z_$][\w$]*\b/m.test(code)) {
    throw new Error('Model must declare at least one class.');
  }
  if (!/@(?:PrimaryGeneratedColumn|PrimaryColumn|Column|CreateDateColumn|UpdateDateColumn)\s*\(/m.test(code)) {
    throw new Error(
      'Model must include at least one TypeORM field decorator such as @PrimaryGeneratedColumn or @Column.'
    );
  }
  if (
    !/require\(\s*['"]typeorm['"]\s*\)/m.test(code) &&
    !/from\s+['"]typeorm['"]/m.test(code)
  ) {
    throw new Error('Model must import TypeORM decorators from "typeorm".');
  }
  if (!/module\.exports\s*=/m.test(code)) {
    throw new Error('Model must export class(es) using module.exports = { ... }.');
  }
};

const normalizeUiExtension = (raw: unknown): string => {
  const allowed = new Set(['jsx', 'js', 'json', 'css']);
  if (!raw || typeof raw !== 'string') return 'jsx';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'jsx';
};

const normalizeSharedPath = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('path is required');
  return raw.trim().replace(/\\/g, '/');
};

const normalizeSharedProjectVersion = (raw: unknown): string => {
  if (raw === undefined || raw === null || raw === '') return SHARED_PROJECT_DEFAULT_VERSION;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('version must be a non-empty string');
  }
  return raw.trim();
};

const normalizeSharedExtension = (path: string, raw?: unknown): string => {
  const normalize = (value: string) => {
    const cleaned = value.replace(/^\./, '').toLowerCase();
    if (cleaned === 'ts') return 'js';
    if (cleaned === 'tsx') return 'jsx';
    return cleaned;
  };
  if (typeof raw === 'string' && raw.trim()) {
    return normalize(raw);
  }
  const ext = path.split('.').pop();
  return ext ? normalize(ext) : 'jsx';
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
};

const normalizeAclPermissionsValue = (value: unknown): Tenant['aclPermissions'] => {
  const obj = asObject(value);
  if (!obj) return { permissions: [] };
  return {
    permissions: Array.isArray(obj.permissions)
      ? obj.permissions.map((item) => {
          const row = asObject(item) ?? {};
          return {
            key: String(row.key ?? ''),
            label: row.label === undefined ? undefined : String(row.label),
          };
        })
      : [],
  };
};

const normalizeAclRolesValue = (value: unknown): Tenant['aclRoles'] => {
  const obj = asObject(value);
  if (!obj) return { roles: {}, groups: {} };
  const rolesObj = asObject(obj.roles) ?? {};
  const groupsObj = asObject(obj.groups) ?? {};
  const roles: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(rolesObj)) {
    roles[key] = asStringArray(val);
  }
  for (const [key, val] of Object.entries(groupsObj)) {
    groups[key] = asStringArray(val);
  }
  return { roles, groups };
};

const normalizeAclEndpointsValue = (value: unknown): Tenant['aclEndpoints'] => {
  const root = asObject(value);
  if (!root) return {};
  const candidate = asObject(root.endpoints) ?? root;
  const output: Tenant['aclEndpoints'] = {};
  for (const [routePath, rawRules] of Object.entries(candidate)) {
    const rules = asObject(rawRules);
    if (!rules) continue;
    output[routePath] = {
      read: asStringArray(rules.read),
      write: asStringArray(rules.write),
      edit: asStringArray(rules.edit),
      delete: asStringArray(rules.delete),
      allowAnonymous: Boolean(rules.allowAnonymous),
    };
  }
  return output;
};

const ensureAclEndpoint = async (tenant: Tenant, routePath: string) => {
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

const snapshotModel = (model: OrmModel): OrmModelSnapshot => ({
  id: model.id,
  path: model.path ?? '',
  code: model.code ?? '',
  fileExtension: model.fileExtension ?? undefined,
  draftVersion: model.draftVersion ?? undefined,
});

const snapshotSharedProject = (
  pkg: GlobalUIPackage | GlobalModulePackage,
  kind: 'ui' | 'module'
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

const snapshotSharedFile = (file: GlobalUIPackageFile | GlobalModulePackageFile): SharedFileSnapshot => ({
  id: file.id,
  path: file.path ?? '',
  content: file.content ?? '',
  fileExtension: file.fileExtension ?? undefined,
});

const ensureSharedProjectWriteAccess = async (
  ctx: AssistantToolContext,
  projectRepo: any,
  project: GlobalUIPackage | GlobalModulePackage
) => {
  const access = ensureSharedProjectEditable(toSharedAccessUser(ctx), project);
  const claimed = claimSharedProjectOwnershipIfNeeded(project, access);
  if (claimed) {
    await (projectRepo as any).save(project as any);
  }
};

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

const listWorkspace = async (
  tenant: Tenant,
  visibility: { includeSharedUi: boolean; includeSharedModules: boolean }
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

const ensureDashboardEntrypoint = async (ctx: AssistantToolContext) => {
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

const createSharedProjectInternal = async (
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

  const getModuleTool = createTool({
    id: 'get_module',
    description: 'Fetch a backend module by id or by route/method.',
    inputSchema: z.object({
      id: z.string().optional(),
      routePath: z.string().optional(),
      method: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.modules.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      let mod: ModuleEntity | null = null;
      if (input.id) {
        mod = await repo.findOne({
          where: { id: input.id, tenant: { id: ctx.tenant.id } },
        });
      } else if (input.routePath && input.method) {
        mod = await repo.findOne({
          where: {
            tenant: { id: ctx.tenant.id },
            routePath: normalizeRoute(input.routePath),
            method: normalizeMethod(input.method),
          },
        });
      } else if (input.routePath) {
        const routePath = normalizeRoute(input.routePath);
        const candidates = await repo.find({
          where: { tenant: { id: ctx.tenant.id }, routePath },
          order: { method: 'ASC', createdAt: 'DESC' },
        });
        if (candidates.length > 0) {
          mod =
            candidates.find((candidate) => candidate.method === HttpMethod.GET) ??
            candidates[0] ??
            null;
        }
      } else {
        throw new Error('Provide id or routePath (optionally with method)');
      }
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
      assertToolPermission(ctx, 'ide.modules.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(ModuleEntity);
      const routePath = normalizeRoute(input.routePath);
      const method = normalizeMethod(input.method);
      const code = normalizeCode(input.code);
      assertBackendModuleContract(code);
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
      assertToolPermission(ctx, 'ide.modules.write');
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
      assertBackendModuleContract(nextCode);
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
      assertToolPermission(ctx, 'ide.modules.write');
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

  const listModelsTool = createTool({
    id: 'list_models',
    description: 'List ORM models for the current tenant.',
    execute: async () => {
      assertToolPermission(ctx, 'ide.models.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const models = await repo.find({
        where: { tenant: { id: ctx.tenant.id } },
        order: { path: 'ASC' },
      });
      return models.map(snapshotModel);
    },
  });

  const getModelTool = createTool({
    id: 'get_model',
    description: 'Fetch an ORM model by id or path.',
    inputSchema: z.object({
      id: z.string().optional(),
      path: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : { tenant: { id: ctx.tenant.id }, path: normalizeModelPath(input.path) };
      const model = await repo.findOne({ where });
      if (!model) throw new Error('Model not found');
      return snapshotModel(model);
    },
  });

  const createModelTool = createTool({
    id: 'create_model',
    description: 'Create a new ORM model file for the current tenant.',
    inputSchema: z.object({
      path: z.string(),
      code: z.string(),
      fileExtension: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const path = normalizeModelPath(input.path);
      const code = normalizeCode(input.code);
      assertOrmModelDecoratorNotation(code);
      const fileExtension = normalizeModelExtension(input.fileExtension);
      const existing = await repo.findOne({
        where: { tenant: { id: ctx.tenant.id }, path },
      });
      if (existing) throw new Error('Model already exists at this path');
      const compiled = compileOrmSource(code, fileExtension);
      const model = repo.create({
        tenant: ctx.tenant,
        path,
        code,
        codeBlob: compiled,
        fileExtension,
        draftVersion: generateVersion(),
      });
      await repo.save(model);
      ctx.changes.push({ kind: 'model', action: 'create', after: snapshotModel(model) });
      return snapshotModel(model);
    },
  });

  const updateModelTool = createTool({
    id: 'update_model',
    description: 'Update an ORM model by id or path.',
    inputSchema: z.object({
      id: z.string().optional(),
      path: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      newPath: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : { tenant: { id: ctx.tenant.id }, path: normalizeModelPath(input.path) };
      const model = await repo.findOne({ where });
      if (!model) throw new Error('Model not found');
      const before = snapshotModel(model);
      const nextPath = input.newPath ? normalizeModelPath(input.newPath) : model.path;
      if (nextPath !== model.path) {
        const duplicate = await repo.findOne({
          where: { tenant: { id: ctx.tenant.id }, path: nextPath },
        });
        if (duplicate && duplicate.id !== model.id) {
          throw new Error('Another model already uses this path');
        }
      }
      const nextCode = input.code !== undefined ? normalizeCode(input.code) : model.code;
      assertOrmModelDecoratorNotation(nextCode);
      const nextExt =
        input.fileExtension !== undefined
          ? normalizeModelExtension(input.fileExtension)
          : model.fileExtension;
      const compiled = compileOrmSource(nextCode, nextExt);
      model.path = nextPath;
      model.code = nextCode;
      model.codeBlob = compiled;
      model.fileExtension = nextExt;
      model.draftVersion = generateVersion();
      await repo.save(model);
      ctx.changes.push({
        kind: 'model',
        action: 'update',
        before,
        after: snapshotModel(model),
      });
      return snapshotModel(model);
    },
  });

  const deleteModelTool = createTool({
    id: 'delete_model',
    description: 'Delete an ORM model by id or path.',
    inputSchema: z.object({
      id: z.string().optional(),
      path: z.string().optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.models.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(OrmModel);
      const where = input.id
        ? { id: input.id, tenant: { id: ctx.tenant.id } }
        : { tenant: { id: ctx.tenant.id }, path: normalizeModelPath(input.path) };
      const model = await repo.findOne({ where });
      if (!model) throw new Error('Model not found');
      const before = snapshotModel(model);
      await repo.remove(model);
      ctx.changes.push({ kind: 'model', action: 'delete', before });
      return { ok: true };
    },
  });

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

  const getAclTool = createTool({
    id: 'get_acl_config',
    description: 'Fetch ACL permissions, roles, and endpoints for the tenant.',
    execute: async () => {
      assertToolPermission(ctx, 'ide.acl.read');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(Tenant);
      const tenant = await repo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) throw new Error('Tenant not found');
      return {
        permissions: normalizeAclPermissionsValue(tenant.aclPermissions),
        roles: normalizeAclRolesValue(tenant.aclRoles),
        endpoints: normalizeAclEndpointsValue(tenant.aclEndpoints),
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
      assertToolPermission(ctx, 'ide.acl.write');
      await ensureCoreSchema();
      const repo = CoreDataSource.getRepository(Tenant);
      const tenant = await repo.findOne({ where: { id: ctx.tenant.id } });
      if (!tenant) throw new Error('Tenant not found');
      const before =
        input.file === 'permissions'
          ? normalizeAclPermissionsValue(tenant.aclPermissions)
          : input.file === 'roles'
          ? normalizeAclRolesValue(tenant.aclRoles)
          : normalizeAclEndpointsValue(tenant.aclEndpoints);
      if (input.file === 'permissions') {
        tenant.aclPermissions = normalizeAclPermissionsValue(input.content);
      } else if (input.file === 'roles') {
        tenant.aclRoles = normalizeAclRolesValue(input.content);
      } else {
        tenant.aclEndpoints = normalizeAclEndpointsValue(input.content);
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
      assertToolPermission(ctx, 'ide.shared_ui.read');
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
      assertToolPermission(ctx, 'ide.shared_modules.read');
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
      assertToolPermission(
        ctx,
        input.projectKind === 'ui' ? 'ide.shared_ui.read' : 'ide.shared_modules.read'
      );
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
    inputSchema: z
      .object({
      projectId: z.string().optional(),
      projectName: z.string().optional(),
      projectVersion: z.string().optional(),
      projectKind: z.enum(['ui', 'module']),
      path: z.string(),
      content: z.string(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      ownerTeamId: z.number().int().positive().optional(),
      editorTeamIds: z.array(z.number().int().positive()).optional(),
      })
      .refine((value) => Boolean(value.projectId || value.projectName), {
        message: 'projectId or projectName is required',
        path: ['projectId'],
      }),
    execute: async (input) => {
      assertToolPermission(
        ctx,
        input.projectKind === 'ui' ? 'ide.shared_ui.write' : 'ide.shared_modules.write'
      );
      await ensureCoreSchema();
      const projectRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackage)
          : CoreDataSource.getRepository(GlobalModulePackage);
      const fileRepo =
        input.projectKind === 'ui'
          ? CoreDataSource.getRepository(GlobalUIPackageFile)
          : CoreDataSource.getRepository(GlobalModulePackageFile);

      const normalizedPath = normalizeSharedPath(input.path);
      if (input.projectKind === 'ui') {
        assertUiCodeIsRuntimeSafe(input.content);
      } else {
        assertNoMockData(input.content, 'Shared backend code');
      }
      let project =
        input.projectId
          ? await projectRepo.findOne({ where: { id: input.projectId } })
          : null;

      if (!project && input.projectName) {
        const projectName = normalizeUiName(input.projectName);
        const projectVersion = input.projectVersion
          ? normalizeSharedProjectVersion(input.projectVersion)
          : null;
        project = projectVersion
          ? await projectRepo.findOne({
              where: { name: projectName, version: projectVersion } as any,
            })
          : await projectRepo.findOne({
              where: { name: projectName } as any,
              order: { createdAt: 'DESC' as any },
            });
      }

      if (!project) {
        if (!input.projectName) {
          throw new Error('Shared project not found');
        }
        const created = await createSharedProjectInternal(
          ctx,
          {
            kind: input.projectKind,
            name: input.projectName,
            version: normalizeSharedProjectVersion(input.projectVersion),
            entryPath: normalizedPath,
            code: input.content,
            fileExtension: input.fileExtension,
            dependencies: input.dependencies,
            ownerTeamId: normalizeOwnerTeamId(input.ownerTeamId),
            editorTeamIds: normalizeTeamIdList(input.editorTeamIds),
          },
          { skipChangeTrack: true }
        );
        project = created.project;
        ctx.changes.push({
          kind: 'shared-project',
          action: 'create',
          after: snapshotSharedProject(project as any, input.projectKind),
        });
      }

      if (!project) {
        throw new Error('Shared project resolution failed');
      }
      const ensuredProject = project;
      await ensureSharedProjectWriteAccess(ctx, projectRepo as any, ensuredProject as any);
      const projectId = (ensuredProject as any).id as string;
      let file = await fileRepo.findOne({
        where: { project: { id: projectId }, path: normalizedPath },
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
        where: { project: { id: projectId } },
        order: { path: 'ASC' },
      });
      await updateSharedBundle(ensuredProject as any, files as any);
      await projectRepo.save(ensuredProject as any);

      if (
        input.projectKind === 'ui' &&
        shouldBuildTailwind((ensuredProject as any).fileExtension) &&
        !isTailwindPackageName((ensuredProject as any).name)
      ) {
        const css = await buildTailwindCssFromFiles(files as any);
        await upsertGlobalTailwindPackage(
          getTailwindPackageName((ensuredProject as any).name),
          (ensuredProject as any).version,
          css
        );
      }

      ctx.changes.push({
        kind: 'shared-file',
        action: before ? 'update' : 'create',
        projectId,
        projectKind: input.projectKind,
        before,
        after: snapshotSharedFile(file),
      });
      return snapshotSharedFile(file);
    },
  });

  const createSharedUiProjectTool = createTool({
    id: 'create_shared_ui_project',
    description: 'Create a shared UI project (admin only).',
    inputSchema: z.object({
      name: z.string(),
      version: z.string().optional(),
      entryPath: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      ownerTeamId: z.number().int().positive().optional(),
      editorTeamIds: z.array(z.number().int().positive()).optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.shared_ui.write');
      await ensureCoreSchema();
      const created = await createSharedProjectInternal(ctx, {
        kind: 'ui',
        name: input.name,
        version: normalizeSharedProjectVersion(input.version),
        entryPath: input.entryPath,
        code: input.code,
        fileExtension: input.fileExtension,
        dependencies: input.dependencies,
        ownerTeamId: input.ownerTeamId,
        editorTeamIds: input.editorTeamIds,
      });
      return snapshotSharedProject(created.project as any, 'ui');
    },
  });

  const createSharedModuleProjectTool = createTool({
    id: 'create_shared_module_project',
    description: 'Create a shared backend project (admin only).',
    inputSchema: z.object({
      name: z.string(),
      version: z.string().optional(),
      entryPath: z.string().optional(),
      code: z.string().optional(),
      fileExtension: z.string().optional(),
      dependencies: z.array(z.string()).optional(),
      ownerTeamId: z.number().int().positive().optional(),
      editorTeamIds: z.array(z.number().int().positive()).optional(),
    }),
    execute: async (input) => {
      assertToolPermission(ctx, 'ide.shared_modules.write');
      await ensureCoreSchema();
      const created = await createSharedProjectInternal(ctx, {
        kind: 'module',
        name: input.name,
        version: normalizeSharedProjectVersion(input.version),
        entryPath: input.entryPath,
        code: input.code,
        fileExtension: input.fileExtension,
        dependencies: input.dependencies,
        ownerTeamId: input.ownerTeamId,
        editorTeamIds: input.editorTeamIds,
      });
      return snapshotSharedProject(created.project as any, 'module');
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
      assertToolPermission(
        ctx,
        input.projectKind === 'ui' ? 'ide.shared_ui.write' : 'ide.shared_modules.write'
      );
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
      await ensureSharedProjectWriteAccess(ctx, projectRepo as any, project as any);
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
