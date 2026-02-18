import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ExplorerNode } from '@/components/FileExplorer';
import type {
  FolderOverride,
  ModuleDto,
  NodeMeta,
  OrmModelDto,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
} from '@/components/editor/types';
import { MODULE_EXTENSION, DEFAULT_MODEL_EXTENSION } from '@/components/editor/constants';
import {
  buildRoutePath,
  buildUiName,
  coerceUiExtension,
  findPathById,
  getScopeInfo,
  getSharedPathFromNodes,
  normalizeModelPath,
  normalizeSharedPath,
  pathStartsWith,
  splitModelPath,
  splitRoutePath,
  splitSharedPath,
  splitUiName,
} from '@/components/editor/utils';
import { resolveSharedExtension } from '@/components/editor/utils';

type MoveRequest = {
  node: ExplorerNode;
  targetId: string;
  position: 'inside' | 'before' | 'after';
  parentPath: ExplorerNode[];
};

type Params = {
  isSharedMode: boolean;
  treeData: ExplorerNode | null;
  sharedProject: SharedProjectDto | null;
  sharedFiles: SharedFileDto[];
  sharedFolderOverrides: string[][];
  sharedBasePath: string;
  adminFetch: (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  apiFetch: (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;
  loadTree: (overrides?: FolderOverride[]) => Promise<void>;
  reloadTree: () => Promise<void>;
  modulesData: ModuleDto[];
  modelsData: OrmModelDto[];
  uiData: UIPackageDto[];
  folderOverrides: FolderOverride[];
  setFolderOverrides: Dispatch<SetStateAction<FolderOverride[]>>;
  setSharedFolderOverrides: Dispatch<SetStateAction<string[][]>>;
  setSharedProject: Dispatch<SetStateAction<SharedProjectDto | null>>;
  setSharedFiles: Dispatch<SetStateAction<SharedFileDto[]>>;
  sharedFilesRef: MutableRefObject<SharedFileDto[]>;
  syncSharedPackage: (
    project: SharedProjectDto,
    files: SharedFileDto[],
    entryPathOverride?: string,
  ) => Promise<SharedProjectDto>;
  showError: (message: string) => void;
};

export const useMoveNodeRequest = ({
  isSharedMode,
  treeData,
  sharedProject,
  sharedFiles,
  sharedFolderOverrides,
  sharedBasePath,
  adminFetch,
  apiFetch,
  loadTree,
  reloadTree,
  modulesData,
  modelsData,
  uiData,
  folderOverrides,
  setFolderOverrides,
  setSharedFolderOverrides,
  setSharedProject,
  setSharedFiles,
  sharedFilesRef,
  syncSharedPackage,
  showError,
}: Params) =>
  useCallback(
    ({ node, targetId, position, parentPath }: MoveRequest) => {
      if (isSharedMode) {
        if (!treeData || !sharedProject) return true;
        const targetPath = findPathById(treeData, targetId);
        if (!targetPath.length) return true;
        const targetParentPath = position === 'inside' ? targetPath : targetPath.slice(0, -1);
        const targetSegments = getSharedPathFromNodes(targetParentPath);

        if (node.type === 'file') {
          const meta = node.meta as NodeMeta | undefined;
          if (!meta || meta.kind !== 'shared') return true;
          const newPath = normalizeSharedPath([...targetSegments, node.name].join('/'));
          const currentPath = normalizeSharedPath(meta.path);
          if (!newPath || newPath === currentPath) return true;
          const duplicate = sharedFiles.some(
            (file) => file.id !== meta.fileId && normalizeSharedPath(file.path) === newPath,
          );
          if (duplicate) {
            showError('A file already exists at that destination.');
            return true;
          }
          (async () => {
            try {
              await adminFetch(`${sharedBasePath}/${sharedProject.id}/files/${meta.fileId}`, {
                method: 'PUT',
                body: {
                  path: newPath,
                  fileExtension: resolveSharedExtension(newPath, meta.fileExtension),
                },
              });
              const nextFiles = sharedFiles.map((file) =>
                file.id === meta.fileId ? { ...file, path: newPath } : file,
              );
              const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
              const nextProject =
                currentPath === entryPath ? { ...sharedProject, entryPath: newPath } : sharedProject;
              const updatedProject = await syncSharedPackage(nextProject, nextFiles);
              setSharedProject(updatedProject);
              setSharedFiles(nextFiles);
              sharedFilesRef.current = nextFiles;
              await reloadTree();
            } catch (err) {
              const message = (err as Error).message || 'Failed to move file';
              showError(message);
            }
          })();
          return true;
        }

        if (node.id === 'root') return true;
        const oldPath = getSharedPathFromNodes([...parentPath, node]);
        const newPath = [...targetSegments, node.name];
        if (oldPath.join('/') === newPath.join('/')) return true;

        (async () => {
          try {
            const updates = sharedFiles.filter((file) =>
              pathStartsWith(splitSharedPath(file.path), oldPath),
            );
            await Promise.all(
              updates.map((file) => {
                const segments = splitSharedPath(file.path);
                const remainder = segments.slice(oldPath.length);
                const nextPath = normalizeSharedPath([...newPath, ...remainder].join('/'));
                return adminFetch(`${sharedBasePath}/${sharedProject.id}/files/${file.id}`, {
                  method: 'PUT',
                  body: { path: nextPath },
                });
              }),
            );
            const nextFiles = sharedFiles.map((file) => {
              if (!pathStartsWith(splitSharedPath(file.path), oldPath)) return file;
              const segments = splitSharedPath(file.path);
              const remainder = segments.slice(oldPath.length);
              return {
                ...file,
                path: normalizeSharedPath([...newPath, ...remainder].join('/')),
              };
            });
            const nextOverrides = sharedFolderOverrides.map((path) => {
              if (!pathStartsWith(path, oldPath)) return path;
              const remainder = path.slice(oldPath.length);
              return [...newPath, ...remainder];
            });
            setSharedFolderOverrides(nextOverrides);
            const entrySegments = splitSharedPath(sharedProject.entryPath || '');
            const nextProject = pathStartsWith(entrySegments, oldPath)
              ? {
                  ...sharedProject,
                  entryPath: normalizeSharedPath(
                    [...newPath, ...entrySegments.slice(oldPath.length)].join('/'),
                  ),
                }
              : sharedProject;
            const updatedProject = await syncSharedPackage(nextProject, nextFiles);
            setSharedProject(updatedProject);
            setSharedFiles(nextFiles);
            sharedFilesRef.current = nextFiles;
            await reloadTree();
          } catch (err) {
            const message = (err as Error).message || 'Failed to move folder';
            showError(message);
          }
        })();
        return true;
      }
      if (!treeData) return true;
      const nodeScopeInfo = getScopeInfo([...parentPath, node]);
      if (!nodeScopeInfo.scope) return true;
      const targetPath = findPathById(treeData, targetId);
      if (!targetPath.length) return true;
      const targetParentPath = position === 'inside' ? targetPath : targetPath.slice(0, -1);
      const targetScopeInfo = getScopeInfo(targetParentPath);
      if (!targetScopeInfo.scope || targetScopeInfo.scope !== nodeScopeInfo.scope) {
        showError('Cannot move between sections.');
        return true;
      }
      if (targetScopeInfo.scope === 'modules' && targetScopeInfo.path[0] === 'acl') {
        showError('ACL folder is read-only.');
        return true;
      }
      if (nodeScopeInfo.scope === 'modules' && nodeScopeInfo.path[0] === 'acl') {
        showError('ACL files cannot be moved.');
        return true;
      }

      if (node.type === 'file') {
        const meta = node.meta as NodeMeta | undefined;
        if (!meta) return true;
        if (meta.kind === 'module') {
          const nextRoute = buildRoutePath(targetScopeInfo.path);
          if (nextRoute === meta.routePath) return true;
          apiFetch(`/api/modules/${meta.backendId}`, {
            method: 'PUT',
            body: {
              routePath: nextRoute,
              method: meta.method,
              fileExtension: MODULE_EXTENSION,
            },
          })
            .then(() => loadTree())
            .catch((err) => {
              const message = (err as Error).message || 'Failed to move module';
              showError(message);
            });
          return true;
        }
        if (meta.kind === 'model') {
          const nextPath = normalizeModelPath([...targetScopeInfo.path, node.name].join('/'));
          if (nextPath === normalizeModelPath(meta.path)) return true;
          apiFetch(`/api/models/${meta.backendId}`, {
            method: 'PUT',
            body: { path: nextPath, fileExtension: DEFAULT_MODEL_EXTENSION },
          })
            .then(() => loadTree())
            .catch((err) => {
              const message = (err as Error).message || 'Failed to move model';
              showError(message);
            });
          return true;
        }
        if (meta.kind !== 'ui') return true;
        const nameSegments = splitUiName(meta.name || 'ui');
        const baseName = nameSegments[nameSegments.length - 1] || 'ui';
        const nextName = buildUiName([...targetScopeInfo.path, baseName]);
        if (nextName === meta.name) return true;
        apiFetch(`/api/ui-entities/${meta.backendId}`, {
          method: 'PUT',
          body: {
            name: nextName,
            version: meta.version,
            dependencies: meta.dependencies ?? [],
            fileExtension: coerceUiExtension(meta.fileExtension),
          },
        })
          .then(() => loadTree())
          .catch((err) => {
            const message = (err as Error).message || 'Failed to move UI entity';
            showError(message);
          });
        return true;
      }

      if (node.id === 'modules-root' || node.id === 'models-root' || node.id === 'ui-root')
        return true;

      const oldPath = nodeScopeInfo.path;
      const newPath = [...targetScopeInfo.path, node.name];
      if (oldPath.join('/') === newPath.join('/')) return true;

      (async () => {
        try {
          if (nodeScopeInfo.scope === 'modules') {
            const updates = modulesData.filter((mod) =>
              pathStartsWith(splitRoutePath(mod.routePath || '/'), oldPath),
            );
            await Promise.all(
              updates.map((mod) => {
                const segments = splitRoutePath(mod.routePath || '/');
                const remainder = segments.slice(oldPath.length);
                const nextRoute = buildRoutePath([...newPath, ...remainder]);
                return apiFetch(`/api/modules/${mod.id}`, {
                  method: 'PUT',
                  body: { routePath: nextRoute, method: mod.method, fileExtension: MODULE_EXTENSION },
                });
              }),
            );
          } else if (nodeScopeInfo.scope === 'models') {
            const updates = modelsData.filter((model) =>
              pathStartsWith(splitModelPath(model.path || ''), oldPath),
            );
            await Promise.all(
              updates.map((model) => {
                const segments = splitModelPath(model.path || '');
                const remainder = segments.slice(oldPath.length);
                const nextPath = normalizeModelPath([...newPath, ...remainder].join('/'));
                return apiFetch(`/api/models/${model.id}`, {
                  method: 'PUT',
                  body: { path: nextPath, fileExtension: DEFAULT_MODEL_EXTENSION },
                });
              }),
            );
          } else {
            const updates = uiData.filter((pkg) =>
              pathStartsWith(splitUiName(pkg.name || ''), oldPath),
            );
            await Promise.all(
              updates.map((pkg) => {
                const segments = splitUiName(pkg.name || '');
                const remainder = segments.slice(oldPath.length);
                const nextName = buildUiName([...newPath, ...remainder]);
                return apiFetch(`/api/ui-entities/${pkg.id}`, {
                  method: 'PUT',
                  body: {
                    name: nextName,
                    version: pkg.version,
                    dependencies: pkg.dependencies ?? [],
                    fileExtension: coerceUiExtension(pkg.fileExtension),
                  },
                });
              }),
            );
          }
          const nextOverrides = folderOverrides.map((item) => {
            if (item.scope !== nodeScopeInfo.scope) return item;
            if (!pathStartsWith(item.path, oldPath)) return item;
            const remainder = item.path.slice(oldPath.length);
            return { scope: nodeScopeInfo.scope, path: [...newPath, ...remainder] };
          });
          setFolderOverrides(nextOverrides);
          await loadTree(nextOverrides);
        } catch (err) {
          const message = (err as Error).message || 'Failed to move folder';
          showError(message);
        }
      })();

      return true;
    },
    [
      adminFetch,
      apiFetch,
      folderOverrides,
      isSharedMode,
      loadTree,
      reloadTree,
      modelsData,
      modulesData,
      sharedBasePath,
      sharedFiles,
      sharedFolderOverrides,
      sharedProject,
      showError,
      syncSharedPackage,
      treeData,
      uiData,
      setFolderOverrides,
      setSharedFiles,
      setSharedFolderOverrides,
      setSharedProject,
      sharedFilesRef,
    ],
  );
