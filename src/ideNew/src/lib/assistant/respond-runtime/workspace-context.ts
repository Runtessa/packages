import { type PreviewExceptionEntry } from '@/lib/assistant/preview-exceptions-store';

const MAX_CONTEXT_CHARS = 240000;

const truncate = (value: string, max = MAX_CONTEXT_CHARS) => {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)`;
};

export type WorkspaceContext = {
  tenant?: {
    id: string;
    hostname: string;
    adapterAccess?: Record<string, { allow: string[] }>;
    resourceConfig?: { memory?: number; timeout?: number } | null;
    authDbConfig?: { mode?: string; secretKey?: string | null } | null;
  };
  modules: Array<{
    id: string;
    routePath: string;
    method: string;
    code: string;
    fileExtension?: string | null;
  }>;
  models: Array<{
    id: string;
    path: string;
    code: string;
    fileExtension?: string | null;
    draftVersion?: string | null;
  }>;
  uiPackages: Array<{
    id: string;
    name: string;
    version: string;
    code: string;
    dependencies: string[];
    fileExtension?: string | null;
  }>;
  sharedUi: Array<{
    id: string;
    name: string;
    version: string;
    entryPath: string;
    code: string;
    dependencies: string[];
  }>;
  sharedModules: Array<{
    id: string;
    name: string;
    version: string;
    entryPath: string;
    code: string;
    dependencies: string[];
  }>;
  sharedUiFiles?: Array<{
    id: string;
    path: string;
    content: string;
    fileExtension?: string | null;
    projectId: string;
    projectName: string;
  }>;
  sharedModuleFiles?: Array<{
    id: string;
    path: string;
    content: string;
    fileExtension?: string | null;
    projectId: string;
    projectName: string;
  }>;
};

const splitRouteSegments = (routePath: string) => {
  const trimmed = String(routePath || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [] as string[];
  return trimmed.split('/').filter(Boolean);
};

const splitUiSegments = (name: string) =>
  String(name || '')
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

const sanitizeForFilename = (value: string) =>
  String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\/\\]+/g, '-')
    .replace(/[:*?<>|"]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

const toModuleVirtualPath = (mod: WorkspaceContext['modules'][number]) => {
  const ext = (mod.fileExtension || 'js').replace(/^\./, '').toLowerCase() || 'js';
  const segments = splitRouteSegments(mod.routePath || '/');
  const routeDir = segments.length ? `${segments.join('/')}/` : '';
  return `modules/${routeDir}${String(mod.method || 'GET').toLowerCase()}.module.${ext}`;
};

const toModelVirtualPath = (model: WorkspaceContext['models'][number]) => {
  const rawPath = String(model.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rawPath) {
    const ext = (model.fileExtension || 'js').replace(/^\./, '').toLowerCase() || 'js';
    return `models/${model.id}.${ext}`;
  }
  return rawPath.toLowerCase().startsWith('models/') ? rawPath : `models/${rawPath}`;
};

const toUiVirtualPath = (pkg: WorkspaceContext['uiPackages'][number]) => {
  const ext = (pkg.fileExtension || 'jsx').replace(/^\./, '').toLowerCase() || 'jsx';
  const nameSegments = splitUiSegments(pkg.name || 'ui');
  const folders = nameSegments.slice(0, -1);
  const base = nameSegments[nameSegments.length - 1] || 'ui';
  const fileName = `${sanitizeForFilename(base)}.ui.${ext}`;
  return folders.length ? `ui/${folders.join('/')}/${fileName}` : `ui/${fileName}`;
};

const toSharedVirtualPath = (
  root: 'shared-ui' | 'shared-modules',
  projectName: string,
  filePath: string
) => {
  const name = String(projectName || '').trim();
  const pathPart = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return `${root}/${name}/${pathPart}`;
};

export const buildContextText = (
  workspace: WorkspaceContext,
  acl: { permissions: unknown; roles: unknown; endpoints: unknown },
  preview?: { enabled: boolean; exceptions: PreviewExceptionEntry[] },
  actor?: { role: string; permissions: string[] }
) => {
  const lines: string[] = [];
  const sharedUiFiles = workspace.sharedUiFiles ?? [];
  const sharedModuleFiles = workspace.sharedModuleFiles ?? [];
  const workspaceToolView = {
    tenant: workspace.tenant ?? null,
    modules: workspace.modules.map((mod) => ({
      id: mod.id,
      routePath: mod.routePath,
      method: mod.method,
      virtualPath: toModuleVirtualPath(mod),
      fileExtension: mod.fileExtension ?? 'js',
    })),
    models: workspace.models.map((model) => ({
      id: model.id,
      path: model.path,
      virtualPath: toModelVirtualPath(model),
      fileExtension: model.fileExtension ?? 'js',
      draftVersion: model.draftVersion ?? null,
    })),
    uiPackages: workspace.uiPackages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      virtualPath: toUiVirtualPath(pkg),
      dependencies: pkg.dependencies ?? [],
      fileExtension: pkg.fileExtension ?? 'jsx',
    })),
    sharedUi: workspace.sharedUi.map((project) => ({
      id: project.id,
      name: project.name,
      version: project.version,
      entryPath: project.entryPath,
      dependencies: project.dependencies ?? [],
    })),
    sharedModules: workspace.sharedModules.map((project) => ({
      id: project.id,
      name: project.name,
      version: project.version,
      entryPath: project.entryPath,
      dependencies: project.dependencies ?? [],
    })),
    sharedUiFiles: sharedUiFiles.map((file) => ({
      id: file.id,
      projectId: file.projectId,
      projectName: file.projectName,
      path: file.path,
      virtualPath: toSharedVirtualPath('shared-ui', file.projectName, file.path),
      fileExtension: file.fileExtension ?? null,
    })),
    sharedModuleFiles: sharedModuleFiles.map((file) => ({
      id: file.id,
      projectId: file.projectId,
      projectName: file.projectName,
      path: file.path,
      virtualPath: toSharedVirtualPath('shared-modules', file.projectName, file.path),
      fileExtension: file.fileExtension ?? null,
    })),
  };
  const aclToolView = {
    permissions: acl.permissions ?? {},
    roles: acl.roles ?? {},
    endpoints: acl.endpoints ?? {},
  };
  lines.push('TOOL OUTPUTS (already executed by host):');
  lines.push('list_workspace =>');
  lines.push(truncate(JSON.stringify(workspaceToolView, null, 2)));
  lines.push('get_acl_config =>');
  lines.push(truncate(JSON.stringify(aclToolView, null, 2)));
  if (actor) {
    lines.push('actor_access =>');
    lines.push(
      truncate(
        JSON.stringify(
          {
            role: actor.role,
            permissions: actor.permissions,
          },
          null,
          2
        )
      )
    );
  }
  lines.push('');
  lines.push('CANONICAL VIRTUAL PATHS FOR MUTATIONS (use these exact roots):');
  lines.push('- modules/... (backend modules)');
  lines.push('- models/... (orm models)');
  lines.push('- ui/... (tenant ui entities)');
  lines.push('- shared-ui/<project>/... (shared ui files)');
  lines.push('- shared-modules/<project>/... (shared backend files)');
  lines.push('UI path mapping rules:');
  lines.push('- ui/<name>.ui.jsx => package "<name>"');
  lines.push('- ui/<name>/index.jsx => package "<name>"');
  lines.push('- ui/<name>/components/Card.jsx => package "<name>/components/Card"');
  lines.push('');
  lines.push('VIRTUAL FILE TREE (exact paths seen by IDE logic):');
  workspace.modules.forEach((mod) => {
    lines.push(`- ${toModuleVirtualPath(mod)}`);
  });
  workspace.models.forEach((model) => {
    lines.push(`- ${toModelVirtualPath(model)}`);
  });
  lines.push('- modules/acl/permissions.json');
  lines.push('- modules/acl/roles.json');
  lines.push('- modules/acl/endpoints.json');
  workspace.uiPackages.forEach((pkg) => {
    lines.push(`- ${toUiVirtualPath(pkg)}`);
  });
  sharedUiFiles.forEach((file) => {
    lines.push(`- ${toSharedVirtualPath('shared-ui', file.projectName, file.path)}`);
  });
  sharedModuleFiles.forEach((file) => {
    lines.push(`- ${toSharedVirtualPath('shared-modules', file.projectName, file.path)}`);
  });
  lines.push('');
  lines.push('Workspace snapshot (FULL PROJECT CONTEXT):');
  if (actor) {
    lines.push(`Actor role: ${actor.role}`);
    lines.push(
      `Actor permissions (${Array.isArray(actor.permissions) ? actor.permissions.length : 0}):`
    );
    (actor.permissions || []).forEach((permission) => {
      lines.push(`- ${permission}`);
    });
  }
  if (workspace.tenant) {
    lines.push(`Tenant: ${workspace.tenant.hostname} (id:${workspace.tenant.id})`);
    lines.push('Tenant adapterAccess JSON:');
    lines.push(truncate(JSON.stringify(workspace.tenant.adapterAccess ?? {}, null, 2)));
    lines.push('Tenant resourceConfig JSON:');
    lines.push(truncate(JSON.stringify(workspace.tenant.resourceConfig ?? {}, null, 2)));
  }
  lines.push(`Modules (${workspace.modules.length}):`);
  workspace.modules.forEach((mod) => {
    lines.push(`- ${mod.method} ${mod.routePath} (id:${mod.id})`);
  });
  lines.push(`ORM Models (${workspace.models.length}):`);
  workspace.models.forEach((model) => {
    lines.push(`- ${model.path} (id:${model.id})`);
  });
  lines.push(`UI Packages (${workspace.uiPackages.length}):`);
  workspace.uiPackages.forEach((pkg) => {
    const ext = pkg.fileExtension ? `.${pkg.fileExtension}` : '';
    lines.push(`- ${pkg.name}@${pkg.version}${ext} (id:${pkg.id})`);
  });
  lines.push(`Shared UI Projects (${workspace.sharedUi.length}):`);
  workspace.sharedUi.forEach((pkg) => {
    lines.push(`- ${pkg.name}@${pkg.version} (id:${pkg.id})`);
  });
  lines.push(`Shared Module Projects (${workspace.sharedModules.length}):`);
  workspace.sharedModules.forEach((pkg) => {
    lines.push(`- ${pkg.name}@${pkg.version} (id:${pkg.id})`);
  });
  lines.push('ACL Permissions JSON:');
  lines.push(truncate(JSON.stringify(acl.permissions ?? {}, null, 2)));
  lines.push('ACL Roles JSON:');
  lines.push(truncate(JSON.stringify(acl.roles ?? {}, null, 2)));
  lines.push('ACL Endpoints JSON:');
  lines.push(truncate(JSON.stringify(acl.endpoints ?? {}, null, 2)));
  lines.push('');
  lines.push('--- FULL SOURCE: BACKEND MODULES ---');
  workspace.modules.forEach((mod) => {
    lines.push(`# FILE: ${toModuleVirtualPath(mod)}`);
    lines.push(mod.code || '');
    lines.push('');
  });
  lines.push('--- FULL SOURCE: ORM MODELS ---');
  workspace.models.forEach((model) => {
    lines.push(`# FILE: ${toModelVirtualPath(model)}`);
    lines.push(model.code || '');
    lines.push('');
  });
  lines.push('--- FULL SOURCE: ACL JSON ---');
  lines.push('# FILE: modules/acl/permissions.json');
  lines.push(JSON.stringify(acl.permissions ?? {}, null, 2));
  lines.push('');
  lines.push('# FILE: modules/acl/roles.json');
  lines.push(JSON.stringify(acl.roles ?? {}, null, 2));
  lines.push('');
  lines.push('# FILE: modules/acl/endpoints.json');
  lines.push(JSON.stringify(acl.endpoints ?? {}, null, 2));
  lines.push('');
  lines.push('--- FULL SOURCE: UI PACKAGES ---');
  workspace.uiPackages.forEach((pkg) => {
    lines.push(`# FILE: ${toUiVirtualPath(pkg)} @${pkg.version}`);
    if (pkg.dependencies?.length) {
      lines.push(`# DEPENDENCIES: ${pkg.dependencies.join(', ')}`);
    }
    lines.push(pkg.code || '');
    lines.push('');
  });
  lines.push('--- FULL SOURCE: SHARED UI PROJECT FILES ---');
  if (sharedUiFiles.length) {
    sharedUiFiles.forEach((file) => {
      lines.push(`# FILE: ${toSharedVirtualPath('shared-ui', file.projectName, file.path)}`);
      lines.push(file.content || '');
      lines.push('');
    });
  } else {
    workspace.sharedUi.forEach((project) => {
      lines.push(
        `# FILE: ${toSharedVirtualPath('shared-ui', project.name, project.entryPath)} @${project.version}`
      );
      if (project.dependencies?.length) {
        lines.push(`# DEPENDENCIES: ${project.dependencies.join(', ')}`);
      }
      lines.push(project.code || '');
      lines.push('');
    });
  }
  lines.push('--- FULL SOURCE: SHARED BACKEND PROJECT FILES ---');
  if (sharedModuleFiles.length) {
    sharedModuleFiles.forEach((file) => {
      lines.push(
        `# FILE: ${toSharedVirtualPath('shared-modules', file.projectName, file.path)}`
      );
      lines.push(file.content || '');
      lines.push('');
    });
  } else {
    workspace.sharedModules.forEach((project) => {
      lines.push(
        `# FILE: ${toSharedVirtualPath('shared-modules', project.name, project.entryPath)} @${project.version}`
      );
      if (project.dependencies?.length) {
        lines.push(`# DEPENDENCIES: ${project.dependencies.join(', ')}`);
      }
      lines.push(project.code || '');
      lines.push('');
    });
  }
  lines.push('--- PREVIEW EXCEPTIONS ---');
  if (preview?.enabled) {
    lines.push(`Watch mode: enabled (captured ${preview.exceptions.length} recent event(s))`);
    preview.exceptions.forEach((item, index) => {
      lines.push(
        `# EXCEPTION ${index + 1}: [${item.level}] ${item.kind} at ${item.createdAt}`
      );
      lines.push(`message: ${item.message}`);
      if (item.requestUrl) {
        lines.push(
          `request: ${item.method || 'GET'} ${item.requestUrl}${item.status ? ` (status ${item.status})` : ''}`
        );
      }
      if (item.sourceUrl) {
        lines.push(
          `source: ${item.sourceUrl}${
            item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : ''
          }`
        );
      }
      if (item.previewName || item.previewVersion) {
        lines.push(`preview: ${item.previewName || '-'}@${item.previewVersion || '-'}`);
      }
      if (item.responseSnippet) {
        lines.push(`response: ${item.responseSnippet}`);
      }
      if (item.stack) {
        lines.push('stack:');
        lines.push(truncate(item.stack, 2000));
      }
      lines.push('');
    });
  } else {
    lines.push('Watch mode: disabled');
  }
  return lines.join('\n');
};

