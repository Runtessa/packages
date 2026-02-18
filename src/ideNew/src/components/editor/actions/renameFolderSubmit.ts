import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { DEFAULT_MODEL_EXTENSION, MODULE_EXTENSION } from '@/components/editor/constants';
import { buildRoutePath, buildUiName, coerceUiExtension, normalizeModelPath, normalizeSharedPath, pathStartsWith, splitModelPath, splitRoutePath, splitSharedPath, splitUiName } from '@/components/editor/utils';
import type {
  FolderOverride,
  ModuleDto,
  OrmModelDto,
  PanelScope,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
} from '@/components/editor/types';

type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

type Params = {
  renameFolderScope: PanelScope | null;
  renameFolderPath: string[];
  renameFolderName: string;
  sharedProject: SharedProjectDto | null;
  sharedFiles: SharedFileDto[];
  sharedFolderOverrides: string[][];
  sharedBasePath: string;
  modulesData: ModuleDto[];
  modelsData: OrmModelDto[];
  uiData: UIPackageDto[];
  folderOverrides: FolderOverride[];
  adminFetch: FetchFn;
  apiFetch: FetchFn;
  closeRenameFolderModal: () => void;
  loadTree: (folderState?: FolderOverride[]) => Promise<void>;
  reloadTree: () => Promise<void>;
  resetActionFeedback: () => void;
  success: (message: string) => void;
  showError: (message: string) => void;
  setSharedFolderOverrides: Dispatch<SetStateAction<string[][]>>;
  setSharedProject: Dispatch<SetStateAction<SharedProjectDto | null>>;
  setSharedFiles: Dispatch<SetStateAction<SharedFileDto[]>>;
  setFolderOverrides: Dispatch<SetStateAction<FolderOverride[]>>;
  sharedFilesRef: MutableRefObject<SharedFileDto[]>;
  syncSharedPackage: (
    project: SharedProjectDto,
    files: SharedFileDto[],
    entryPathOverride?: string
  ) => Promise<SharedProjectDto>;
};

export const submitRenameFolder = async ({
  renameFolderScope,
  renameFolderPath,
  renameFolderName,
  sharedProject,
  sharedFiles,
  sharedFolderOverrides,
  sharedBasePath,
  modulesData,
  modelsData,
  uiData,
  folderOverrides,
  adminFetch,
  apiFetch,
  closeRenameFolderModal,
  loadTree,
  reloadTree,
  resetActionFeedback,
  success,
  showError,
  setSharedFolderOverrides,
  setSharedProject,
  setSharedFiles,
  setFolderOverrides,
  sharedFilesRef,
  syncSharedPackage,
}: Params): Promise<void> => {
  if (!renameFolderScope || !renameFolderPath.length) return;
  if (renameFolderScope === 'modules' && renameFolderPath[0] === 'acl') {
    showError('ACL folder cannot be renamed.');
    return;
  }
  const newName = renameFolderName.trim();
  if (!newName || /[\\/]/.test(newName)) {
    showError('Folder name cannot be empty or contain slashes.');
    return;
  }
  const oldPath = renameFolderPath;
  const newPath = [...oldPath.slice(0, -1), newName];

  resetActionFeedback();
  try {
    if (renameFolderScope === 'shared') {
      if (!sharedProject) {
        showError('Shared project is not loaded.');
        return;
      }
      const updates = sharedFiles.filter((file) =>
        pathStartsWith(splitSharedPath(file.path), oldPath),
      );
      await Promise.all(
        updates.map((file) => {
          const segments = splitSharedPath(file.path);
          const remainder = segments.slice(oldPath.length);
          const nextPath = normalizeSharedPath([...newPath, ...remainder].join('/'));
          return adminFetch(
            `${sharedBasePath}/${sharedProject.id}/files/${file.id}`,
            { method: 'PUT', body: { path: nextPath } },
          );
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
      success('Folder updated');
      closeRenameFolderModal();
      await reloadTree();
      return;
    } else if (renameFolderScope === 'modules') {
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
    } else if (renameFolderScope === 'models') {
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
      if (item.scope !== renameFolderScope) return item;
      if (!pathStartsWith(item.path, oldPath)) return item;
      const remainder = item.path.slice(oldPath.length);
      return { scope: renameFolderScope, path: [...newPath, ...remainder] };
    });
    setFolderOverrides(nextOverrides);
    success('Folder updated');
    closeRenameFolderModal();
    await loadTree(nextOverrides);
  } catch (err) {
    const message = (err as Error).message || 'Failed to rename folder';
    showError(message);
  }
};
