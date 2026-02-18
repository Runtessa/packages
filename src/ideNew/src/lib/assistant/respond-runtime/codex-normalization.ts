import type { WorkspaceContext } from './workspace-context';

export const DEFAULT_UI_VERSION = '1.0.0';
export const DEFAULT_UI_CODE = `import React from 'react';
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

const CODEX_TOOL_ALIASES: Record<string, string> = {
  'create-module': 'create_module',
  createModule: 'create_module',
  'update-module': 'update_module',
  updateModule: 'update_module',
  'delete-module': 'delete_module',
  deleteModule: 'delete_module',
  'create-model': 'create_model',
  createModel: 'create_model',
  'update-model': 'update_model',
  updateModel: 'update_model',
  'delete-model': 'delete_model',
  deleteModel: 'delete_model',
  'create-ui-package': 'create_ui_package',
  createUiPackage: 'create_ui_package',
  'update-ui-package': 'update_ui_package',
  updateUiPackage: 'update_ui_package',
  'delete-ui-package': 'delete_ui_package',
  deleteUiPackage: 'delete_ui_package',
  'update-acl-file': 'update_acl_file',
  updateAclFile: 'update_acl_file',
  'write-shared-file': 'write_shared_file',
  writeSharedFile: 'write_shared_file',
  'delete-shared-file': 'delete_shared_file',
  deleteSharedFile: 'delete_shared_file',
  'get-shared-file': 'get_shared_file',
  getSharedFile: 'get_shared_file',
  'get-module': 'get_module',
  getModule: 'get_module',
  'get-model': 'get_model',
  getModel: 'get_model',
  'get-ui-package': 'get_ui_package',
  getUiPackage: 'get_ui_package',
  'create-shared-ui-project': 'create_shared_ui_project',
  createSharedUiProject: 'create_shared_ui_project',
  'create-shared-module-project': 'create_shared_module_project',
  createSharedModuleProject: 'create_shared_module_project',
  'create-file': 'create_file',
  createFile: 'create_file',
  'update-file': 'update_file',
  updateFile: 'update_file',
  'delete-file': 'delete_file',
  deleteFile: 'delete_file',
  'edit-file': 'update_file',
  editFile: 'update_file',
  'write-file': 'update_file',
  writeFile: 'update_file',
  'save-file': 'update_file',
  saveFile: 'update_file',
  'editor-create-file': 'create_file',
  editorCreateFile: 'create_file',
  'editor-update-file': 'update_file',
  editorUpdateFile: 'update_file',
  'editor-delete-file': 'delete_file',
  editorDeleteFile: 'delete_file',
};

export const toToolId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const direct = CODEX_TOOL_ALIASES[trimmed];
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  if (CODEX_TOOL_ALIASES[lower]) return CODEX_TOOL_ALIASES[lower];
  return lower;
};

export const pickInput = (input: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (input[key] !== undefined) return input[key];
  }
  return undefined;
};

const putIfDefined = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (value === undefined || value === null) return;
  target[key] = value;
};

export const normalizeModelPathInput = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) return trimmed;
  const withPrefix = trimmed.includes('/') ? trimmed : `models/${trimmed}`;
  const hasExt = /\.[a-zA-Z0-9]+$/.test(withPrefix);
  return hasExt ? withPrefix : `${withPrefix}.js`;
};

export const normalizeProjectKind = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ui' || normalized === 'shared-ui' || normalized === 'shared_ui') return 'ui';
  if (
    normalized === 'module' ||
    normalized === 'modules' ||
    normalized === 'shared-module' ||
    normalized === 'shared_module' ||
    normalized === 'backend'
  ) {
    return 'module';
  }
  return value;
};

const parseModuleLookupFromPath = (value: unknown) => {
  if (typeof value !== 'string') return {};
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const trimmed = normalized.toLowerCase().startsWith('modules/')
    ? normalized.slice('modules/'.length)
    : normalized;
  const match = trimmed.match(
    /^(.*)\/(get|post|put|patch|delete|head|options)\.module\.[a-z0-9]+$/i,
  );
  if (!match) return {};
  const routePart = match[1] || '';
  return {
    routePath: routePart ? `/${routePart}` : '/',
    method: String(match[2] || '').toUpperCase(),
  };
};

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const normalizeHttpMethod = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const method = value.trim().toUpperCase();
  if (!method) return undefined;
  return HTTP_METHODS.has(method) ? method : undefined;
};

const inferMethodFromModuleCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const code = value;
  const patterns = [
    /req\.method\s*!==\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/gi,
    /req\.method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/gi,
    /case\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]\s*:/gi,
  ];
  const hits: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(code)) !== null) {
      const method = String(match[1] || '').toUpperCase();
      if (HTTP_METHODS.has(method) && !hits.includes(method)) {
        hits.push(method);
      }
    }
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) return undefined;
  for (const preferred of ['POST', 'PATCH', 'PUT', 'DELETE', 'GET']) {
    if (hits.includes(preferred)) return preferred;
  }
  return hits[0];
};

const parseUiLookupFromValue = (value: unknown) => {
  if (typeof value !== 'string') return {};
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const raw = normalized.toLowerCase().startsWith('ui/')
    ? normalized.slice('ui/'.length)
    : normalized;

  const uiFileMatch = raw.match(/^(.*)\.ui\.[^.\/]+$/i);
  if (uiFileMatch?.[1]) {
    return { name: uiFileMatch[1] };
  }

  const at = raw.lastIndexOf('@');
  if (at > 0 && at + 1 < raw.length && /\d/.test(raw[at + 1] ?? '')) {
    return {
      name: raw.slice(0, at),
      version: raw.slice(at + 1),
    };
  }

  const segments = raw.split('/').filter(Boolean);
  if (segments.length >= 2 && /^index\.[a-z0-9]+$/i.test(segments[segments.length - 1] || '')) {
    return { name: segments.slice(0, -1).join('/') };
  }

  if (segments.length >= 2) {
    const last = segments[segments.length - 1] || '';
    const extMatch = last.match(/^(.+)\.([a-z0-9]+)$/i);
    if (extMatch?.[1]) {
      const base = extMatch[1];
      const ext = extMatch[2]?.toLowerCase();
      if (ext && ['jsx', 'js', 'json', 'css'].includes(ext)) {
        if (base.toLowerCase() === 'index') {
          return { name: segments.slice(0, -1).join('/') };
        }
        return { name: [...segments.slice(0, -1), base].join('/') };
      }
    }
  }

  return {};
};

const inferAclFileFromContent = (content: unknown): 'permissions' | 'roles' | 'endpoints' | null => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const obj = content as Record<string, unknown>;
  if (Array.isArray(obj.permissions)) return 'permissions';
  if (obj.roles !== undefined || obj.groups !== undefined) return 'roles';
  if (obj.endpoints && typeof obj.endpoints === 'object') return 'endpoints';
  const keys = Object.keys(obj);
  if (!keys.length) return null;
  if (keys.some((key) => key.startsWith('/api/'))) return 'endpoints';
  return null;
};

const parseSharedPathInput = (
  rawPath: unknown,
): { projectKind?: 'ui' | 'module'; projectName?: string; path?: string } => {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return {};
  const normalized = rawPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const uiMatch = normalized.match(/^shared-ui\/([^/]+)\/(.+)$/i);
  if (uiMatch?.[1] && uiMatch?.[2]) {
    return {
      projectKind: 'ui',
      projectName: uiMatch[1],
      path: uiMatch[2],
    };
  }
  const moduleMatch = normalized.match(/^(shared-modules|shared-backend)\/([^/]+)\/(.+)$/i);
  if (moduleMatch?.[2] && moduleMatch?.[3]) {
    return {
      projectKind: 'module',
      projectName: moduleMatch[2],
      path: moduleMatch[3],
    };
  }
  return { path: normalized };
};

export const normalizeOperationInput = (
  toolId: string,
  input: Record<string, unknown>,
  workspace?: WorkspaceContext,
) => {
  const next: Record<string, unknown> = {};
  const modules = workspace?.modules ?? [];
  const uiPackages = workspace?.uiPackages ?? [];
  const sharedUiProjects = workspace?.sharedUi ?? [];
  const sharedModuleProjects = workspace?.sharedModules ?? [];

  const findUiByName = (name: string) =>
    uiPackages.find((pkg) => pkg.name === name) || null;
  const findUiById = (id: string) => uiPackages.find((pkg) => pkg.id === id) || null;
  const findModuleByRoute = (routePath: string, method?: string) =>
    modules.find(
      (mod) =>
        mod.routePath === routePath &&
        (!method || mod.method.toUpperCase() === method.toUpperCase()),
    ) || null;
  const resolveSharedProjectId = (kind: 'ui' | 'module', projectName: string) => {
    const list = kind === 'ui' ? sharedUiProjects : sharedModuleProjects;
    return list.find((project) => project.name === projectName)?.id;
  };

  if (toolId === 'create_module' || toolId === 'update_module' || toolId === 'delete_module') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'moduleId', 'module_id']));
    const rawRoutePath = pickInput(input, ['routePath', 'route', 'path', 'route_path', 'endpoint']);
    const parsedFromPath = parseModuleLookupFromPath(rawRoutePath);
    const rawCode = pickInput(input, ['code', 'content', 'source', 'body']);
    putIfDefined(
      next,
      'routePath',
      parsedFromPath.routePath ??
        (typeof rawRoutePath === 'string' ? rawRoutePath : undefined),
    );
    const method = pickInput(input, ['method', 'httpMethod', 'http_method', 'verb']);
    const normalizedMethod =
      normalizeHttpMethod(method) ??
      normalizeHttpMethod(parsedFromPath.method) ??
      inferMethodFromModuleCode(rawCode) ??
      (toolId === 'create_module' ? 'GET' : undefined);
    putIfDefined(next, 'method', normalizedMethod);
    if (!next.id && typeof next.routePath === 'string') {
      const resolved = findModuleByRoute(String(next.routePath), String(next.method || ''));
      if (resolved) {
        next.id = resolved.id;
        if (!next.method) next.method = resolved.method;
      }
    }
    putIfDefined(next, 'code', rawCode);
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    return next;
  }

  if (toolId === 'create_model' || toolId === 'update_model' || toolId === 'delete_model') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'modelId', 'model_id']));
    putIfDefined(next, 'path', normalizeModelPathInput(pickInput(input, ['path', 'modelPath', 'filePath', 'file', 'name'])));
    putIfDefined(next, 'newPath', normalizeModelPathInput(pickInput(input, ['newPath', 'new_path', 'targetPath', 'toPath'])));
    putIfDefined(next, 'code', pickInput(input, ['code', 'content', 'source', 'body']));
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    return next;
  }

  if (
    toolId === 'create_ui_package' ||
    toolId === 'update_ui_package' ||
    toolId === 'delete_ui_package' ||
    toolId === 'get_ui_package'
  ) {
    putIfDefined(next, 'id', pickInput(input, ['id', 'uiId', 'packageId', 'package_id']));
    const rawName = pickInput(input, ['name', 'package', 'packageName', 'uiName', 'path', 'filePath', 'file']);
    const rawPath = pickInput(input, ['path', 'filePath', 'file', 'virtualPath']);
    const parsedFromPath = parseUiLookupFromValue(rawPath ?? rawName);
    const name =
      (typeof rawName === 'string' && rawName.trim() ? rawName : undefined) ??
      parsedFromPath.name;
    putIfDefined(next, 'name', name);
    const rawVersion = pickInput(input, ['version', 'packageVersion', 'pkgVersion']);
    const version =
      (typeof rawVersion === 'string' && rawVersion.trim() ? rawVersion : undefined) ??
      parsedFromPath.version;
    putIfDefined(next, 'version', version);
    if (!next.id && typeof next.name === 'string') {
      const resolved = findUiByName(next.name);
      if (resolved) {
        next.id = resolved.id;
        if (!next.version) next.version = resolved.version;
      }
    } else if (typeof next.id === 'string' && !next.version) {
      const resolved = findUiById(next.id);
      if (resolved) {
        next.version = resolved.version;
        next.name = next.name || resolved.name;
      }
    }
    const rawCode = pickInput(input, ['code', 'content', 'source', 'body']);
    if (typeof rawCode === 'string') {
      next.code = rawCode;
    } else if (toolId === 'create_ui_package') {
      next.code = DEFAULT_UI_CODE;
    }
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    putIfDefined(next, 'dependencies', pickInput(input, ['dependencies', 'deps']));
    if (toolId === 'create_ui_package' && typeof next.version !== 'string') {
      next.version = DEFAULT_UI_VERSION;
    }
    if (toolId === 'update_ui_package' && !next.id && typeof next.name === 'string') {
      const resolved = findUiByName(next.name);
      if (resolved) {
        next.id = resolved.id;
        next.version = resolved.version;
      } else if (typeof next.version !== 'string') {
        next.version = DEFAULT_UI_VERSION;
      }
    }
    return next;
  }

  if (toolId === 'create_shared_ui_project' || toolId === 'create_shared_module_project') {
    putIfDefined(next, 'name', pickInput(input, ['name', 'projectName', 'project', 'packageName']));
    putIfDefined(next, 'version', pickInput(input, ['version', 'projectVersion', 'pkgVersion']));
    putIfDefined(next, 'entryPath', pickInput(input, ['entryPath', 'entry', 'path']));
    putIfDefined(next, 'code', pickInput(input, ['code', 'content', 'source', 'body']));
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    putIfDefined(next, 'dependencies', pickInput(input, ['dependencies', 'deps']));
    return next;
  }

  if (toolId === 'update_acl_file') {
    const rawFile = pickInput(input, ['file', 'name', 'target', 'aclFile']);
    const content = pickInput(input, ['content', 'value', 'data', 'json']);
    const inferredFile =
      (typeof rawFile === 'string' ? rawFile.trim().toLowerCase() : '') ||
      inferAclFileFromContent(content) ||
      inferAclFileFromContent(input);
    if (inferredFile === 'permissions' || inferredFile === 'roles' || inferredFile === 'endpoints') {
      next.file = inferredFile;
    }
    if (content !== undefined) {
      next.content = content;
    } else if (inferredFile && typeof input === 'object' && input) {
      if (inferredFile === 'permissions' && (input as any).permissions !== undefined) {
        next.content = { permissions: (input as any).permissions };
      } else if (inferredFile === 'roles' && ((input as any).roles !== undefined || (input as any).groups !== undefined)) {
        next.content = {
          roles: (input as any).roles ?? {},
          groups: (input as any).groups ?? {},
        };
      } else if (inferredFile === 'endpoints') {
        const obj = input as Record<string, unknown>;
        next.content = obj.endpoints && typeof obj.endpoints === 'object' ? obj.endpoints : obj;
      }
    }
    return next;
  }

  if (toolId === 'write_shared_file' || toolId === 'delete_shared_file' || toolId === 'get_shared_file') {
    putIfDefined(next, 'projectId', pickInput(input, ['projectId', 'project_id', 'sharedProjectId']));
    putIfDefined(next, 'fileId', pickInput(input, ['fileId', 'file_id']));
    const rawPath = pickInput(input, ['path', 'filePath', 'file']);
    const parsedSharedPath = parseSharedPathInput(rawPath);
    putIfDefined(next, 'path', parsedSharedPath.path);
    putIfDefined(next, 'content', pickInput(input, ['content', 'code', 'source', 'body']));
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    const projectKind =
      normalizeProjectKind(pickInput(input, ['projectKind', 'kind', 'type'])) ??
      parsedSharedPath.projectKind;
    putIfDefined(next, 'projectKind', projectKind);
    const explicitProjectName = pickInput(input, ['projectName', 'project', 'name']);
    const projectName =
      (typeof explicitProjectName === 'string' ? explicitProjectName : undefined) ??
      parsedSharedPath.projectName;
    putIfDefined(next, 'projectName', projectName);
    putIfDefined(next, 'projectVersion', pickInput(input, ['projectVersion', 'version', 'pkgVersion']));
    putIfDefined(next, 'dependencies', pickInput(input, ['dependencies', 'deps']));
    if (!next.projectId) {
      if (typeof projectName === 'string' && typeof projectKind === 'string') {
        const resolved = resolveSharedProjectId(projectKind as 'ui' | 'module', projectName);
        if (resolved) next.projectId = resolved;
      }
    }
    return next;
  }

  if (toolId === 'get_module') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'moduleId', 'module_id']));
    const rawPath = pickInput(input, ['routePath', 'route', 'path', 'filePath', 'file', 'virtualPath']);
    const parsedFromPath = parseModuleLookupFromPath(rawPath);
    putIfDefined(
      next,
      'routePath',
      parsedFromPath.routePath ??
        (typeof rawPath === 'string' ? rawPath : undefined),
    );
    const method = pickInput(input, ['method', 'httpMethod', 'verb']);
    const normalizedMethod =
      typeof method === 'string' && method.trim()
        ? method.toUpperCase()
        : parsedFromPath.method;
    putIfDefined(next, 'method', normalizedMethod);
    if (!next.id && typeof next.routePath === 'string') {
      const resolved = findModuleByRoute(String(next.routePath), typeof next.method === 'string' ? next.method : undefined);
      if (resolved) {
        next.id = resolved.id;
        next.method = resolved.method;
      }
    }
    return next;
  }

  if (toolId === 'get_model') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'modelId', 'model_id']));
    putIfDefined(next, 'path', normalizeModelPathInput(pickInput(input, ['path', 'modelPath', 'filePath', 'file'])));
    return next;
  }

  return input;
};

export const normalizePath = (value: string) =>
  value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
