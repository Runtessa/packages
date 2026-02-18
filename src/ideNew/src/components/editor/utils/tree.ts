import type { ExplorerNode } from '@/components/FileExplorer';
import type {
  AclConfigDto,
  ExplorerScope,
  FolderOverride,
  ModuleDto,
  NodeMeta,
  OrmModelDto,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
} from '@/components/editor/types';
import {
  ACL_FILE_NAMES,
  ACL_FOLDER_NAME,
  DEFAULT_ACL_ENDPOINTS,
  DEFAULT_ACL_PERMISSIONS,
  DEFAULT_ACL_ROLES,
} from '@/components/editor/constants';
import {
  coerceModuleExtension,
  coerceUiExtension,
  formatModuleFileName,
  formatUiFileName,
  getSharedNodeId,
  normalizeModelPath,
  splitModelPath,
  splitRoutePath,
  splitSharedPath,
  splitUiName,
} from './paths';

export const makeSharedFolderId = (segments: string[]) => `shared-folder-${segments.join('/')}`;

export const ensureSharedFolderPath = (root: ExplorerNode, segments: string[]) => {
  let current = root;
  segments.forEach((segment, idx) => {
    const path = segments.slice(0, idx + 1);
    const id = makeSharedFolderId(path);
    const existing = current.children?.find((child) => child.type === 'folder' && child.id === id);
    if (existing) {
      current = existing;
      return;
    }
    const next: ExplorerNode = {
      id,
      name: segment,
      type: 'folder',
      children: [],
    };
    current.children = [...(current.children ?? []), next];
    current = next;
  });
  return current;
};

const ensureFolderPath = (root: ExplorerNode, scope: ExplorerScope, segments: string[]) => {
  let current = root;
  segments.forEach((segment, idx) => {
    const path = segments.slice(0, idx + 1);
    const id = `${scope}-folder-${path.join('/')}`;
    const existing = current.children?.find((child) => child.type === 'folder' && child.id === id);
    if (existing) {
      current = existing;
      return;
    }
    const next: ExplorerNode = {
      id,
      name: segment,
      type: 'folder',
      children: [],
    };
    current.children = [...(current.children ?? []), next];
    current = next;
  });
  return current;
};

export const buildSharedTree = (
  project: SharedProjectDto | null,
  files: SharedFileDto[],
  overrides: string[][],
  options?: { rootLabel?: string; sharedKind?: 'ui' | 'module' },
): ExplorerNode => {
  const root: ExplorerNode = {
    id: 'root',
    name: project?.name || options?.rootLabel || 'Shared Project',
    type: 'folder',
    children: [],
  };

  files.forEach((file) => {
    const segments = splitSharedPath(file.path);
    const fileName = segments.pop() || file.path || 'untitled';
    const parent = ensureSharedFolderPath(root, segments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: getSharedNodeId(file.id),
        name: fileName,
        type: 'file',
        meta: {
          kind: 'shared',
          projectId: project?.id ?? '',
          fileId: file.id,
          path: file.path,
          fileExtension: file.fileExtension,
          sharedKind: options?.sharedKind,
        } as NodeMeta,
        content: file.content,
      },
    ];
  });

  overrides.forEach((path) => {
    ensureSharedFolderPath(root, path);
  });

  return root;
};

export const buildSharedContentMap = (files: SharedFileDto[]) => {
  const next: Record<string, string> = {};
  files.forEach((file) => {
    next[getSharedNodeId(file.id)] = file.content ?? '';
  });
  return next;
};

const addAclFiles = (modulesRoot: ExplorerNode, aclConfig?: AclConfigDto | null) => {
  const aclFolder = ensureFolderPath(modulesRoot, 'modules', [ACL_FOLDER_NAME]);
  const permissionsContent =
    JSON.stringify(aclConfig?.permissions ?? JSON.parse(DEFAULT_ACL_PERMISSIONS), null, 2) + '\n';
  const rolesContent = JSON.stringify(aclConfig?.roles ?? JSON.parse(DEFAULT_ACL_ROLES), null, 2) + '\n';
  const endpointsContent =
    JSON.stringify(aclConfig?.endpoints ?? JSON.parse(DEFAULT_ACL_ENDPOINTS), null, 2) + '\n';

  aclFolder.children = [
    ...(aclFolder.children ?? []),
    {
      id: 'acl-permissions',
      name: ACL_FILE_NAMES.permissions,
      type: 'file',
      meta: { kind: 'acl', file: 'permissions' } as NodeMeta,
      content: permissionsContent,
    },
    {
      id: 'acl-roles',
      name: ACL_FILE_NAMES.roles,
      type: 'file',
      meta: { kind: 'acl', file: 'roles' } as NodeMeta,
      content: rolesContent,
    },
    {
      id: 'acl-endpoints',
      name: ACL_FILE_NAMES.endpoints,
      type: 'file',
      meta: { kind: 'acl', file: 'endpoints' } as NodeMeta,
      content: endpointsContent,
    },
  ];
};

export const buildExplorerTree = (
  modules: ModuleDto[],
  uiPackages: UIPackageDto[],
  models: OrmModelDto[],
  overrides: FolderOverride[],
  aclConfig?: AclConfigDto | null,
): ExplorerNode => {
  const modulesRoot: ExplorerNode = {
    id: 'modules-root',
    name: 'Modules',
    type: 'folder',
    children: [],
  };
  const modelsRoot: ExplorerNode = {
    id: 'models-root',
    name: 'Models',
    type: 'folder',
    children: [],
  };
  const uiRoot: ExplorerNode = {
    id: 'ui-root',
    name: 'UI Entities',
    type: 'folder',
    children: [],
  };

  modules.forEach((mod) => {
    const segments = splitRoutePath(mod.routePath || '/');
    const parent = ensureFolderPath(modulesRoot, 'modules', segments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: `module-${mod.id}`,
        name: formatModuleFileName(mod),
        type: 'file',
        meta: {
          kind: 'module',
          backendId: mod.id,
          method: mod.method,
          routePath: mod.routePath,
          fileExtension: coerceModuleExtension(mod.fileExtension),
        } as NodeMeta,
        content: mod.code,
      },
    ];
  });

  models.forEach((model) => {
    const segments = splitModelPath(model.path || '');
    const fileName = segments.pop() || normalizeModelPath(model.path || '') || 'model.js';
    const parent = ensureFolderPath(modelsRoot, 'models', segments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: `model-${model.id}`,
        name: fileName,
        type: 'file',
        meta: {
          kind: 'model',
          backendId: model.id,
          path: model.path,
          fileExtension: model.fileExtension,
        } as NodeMeta,
        content: model.code,
      },
    ];
  });

  uiPackages.forEach((pkg) => {
    const nameSegments = splitUiName(pkg.name || 'ui');
    const folderSegments = nameSegments.slice(0, -1);
    const parent = ensureFolderPath(uiRoot, 'ui', folderSegments);
    parent.children = [
      ...(parent.children ?? []),
      {
        id: `ui-${pkg.id}`,
        name: formatUiFileName(pkg),
        type: 'file',
        meta: {
          kind: 'ui',
          backendId: pkg.id,
          name: pkg.name,
          version: pkg.version,
          dependencies: pkg.dependencies ?? [],
          fileExtension: coerceUiExtension(pkg.fileExtension),
        } as NodeMeta,
        content: pkg.code ?? pkg.codeBlob,
      },
    ];
  });

  overrides.forEach((override) => {
    const root =
      override.scope === 'modules'
        ? modulesRoot
        : override.scope === 'models'
          ? modelsRoot
          : uiRoot;
    ensureFolderPath(root, override.scope, override.path);
  });

  addAclFiles(modulesRoot, aclConfig);

  return {
    id: 'root',
    name: 'PROJECT',
    type: 'folder',
    children: [modulesRoot, modelsRoot, uiRoot],
  };
};

export const buildPersistedContentMap = (
  modules: ModuleDto[],
  uiPackages: UIPackageDto[],
  models: OrmModelDto[],
  aclConfig?: AclConfigDto | null,
): Record<string, string> => {
  const next: Record<string, string> = {};
  modules.forEach((mod) => {
    next[`module-${mod.id}`] = mod.code ?? '';
  });
  models.forEach((model) => {
    next[`model-${model.id}`] = model.code ?? '';
  });
  uiPackages.forEach((pkg) => {
    next[`ui-${pkg.id}`] = pkg.code ?? pkg.codeBlob ?? '';
  });
  if (aclConfig) {
    next['acl-permissions'] = JSON.stringify(aclConfig.permissions ?? {}, null, 2) + '\n';
    next['acl-roles'] = JSON.stringify(aclConfig.roles ?? {}, null, 2) + '\n';
    next['acl-endpoints'] = JSON.stringify(aclConfig.endpoints ?? {}, null, 2) + '\n';
  }
  return next;
};
