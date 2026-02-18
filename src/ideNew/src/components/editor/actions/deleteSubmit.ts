import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { getSharedNodeId, normalizeSharedPath, pathStartsWith, splitModelPath, splitRoutePath, splitSharedPath, splitUiName } from '@/components/editor/utils';
import type {
  DeleteTarget,
  FolderOverride,
  ModuleDto,
  OrmModelDto,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
} from '@/components/editor/types';

type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

type Params = {
  deleteTarget: DeleteTarget | null;
  sharedProject: SharedProjectDto | null;
  sharedFiles: SharedFileDto[];
  sharedFolderOverrides: string[][];
  sharedBasePath: string;
  savedContents: Record<string, string>;
  folderOverrides: FolderOverride[];
  modulesData: ModuleDto[];
  modelsData: OrmModelDto[];
  uiData: UIPackageDto[];
  adminFetch: FetchFn;
  apiFetch: FetchFn;
  closeDeleteModal: () => void;
  loadTree: (folderState?: FolderOverride[]) => Promise<void>;
  reloadTree: () => Promise<void>;
  removeFileEntries: (ids: Set<string>) => void;
  resetActionFeedback: () => void;
  success: (message: string) => void;
  showError: (message: string) => void;
  setSavedContents: Dispatch<SetStateAction<Record<string, string>>>;
  setFolderOverrides: Dispatch<SetStateAction<FolderOverride[]>>;
  setSharedFolderOverrides: Dispatch<SetStateAction<string[][]>>;
  setSharedProject: Dispatch<SetStateAction<SharedProjectDto | null>>;
  setSharedFiles: Dispatch<SetStateAction<SharedFileDto[]>>;
  savedContentsRef: MutableRefObject<Record<string, string>>;
  sharedFilesRef: MutableRefObject<SharedFileDto[]>;
  syncSharedPackage: (
    project: SharedProjectDto,
    files: SharedFileDto[],
    entryPathOverride?: string
  ) => Promise<SharedProjectDto>;
};

export const submitDelete = async ({
  deleteTarget,
  sharedProject,
  sharedFiles,
  sharedFolderOverrides,
  sharedBasePath,
  savedContents,
  folderOverrides,
  modulesData,
  modelsData,
  uiData,
  adminFetch,
  apiFetch,
  closeDeleteModal,
  loadTree,
  reloadTree,
  removeFileEntries,
  resetActionFeedback,
  success,
  showError,
  setSavedContents,
  setFolderOverrides,
  setSharedFolderOverrides,
  setSharedProject,
  setSharedFiles,
  savedContentsRef,
  sharedFilesRef,
  syncSharedPackage,
}: Params): Promise<void> => {
  if (!deleteTarget) return;
  resetActionFeedback();
  try {
    if (deleteTarget.type === 'file') {
      const meta = deleteTarget.meta;
      if (meta.kind === 'acl') {
        showError('ACL files cannot be deleted.');
        return;
      }
      if (meta.kind === 'shared') {
        if (!sharedProject) {
          showError('Shared project is not loaded.');
          return;
        }
        const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
        if (normalizeSharedPath(meta.path) === entryPath) {
          showError('Cannot delete the entry file. Update entry path first.');
          return;
        }
        await adminFetch(
          `${sharedBasePath}/${sharedProject.id}/files/${meta.fileId}`,
          { method: 'DELETE' },
        );
        const nextFiles = sharedFiles.filter((file) => file.id !== meta.fileId);
        const nextSaved = { ...savedContents };
        const nodeId = getSharedNodeId(meta.fileId);
        delete nextSaved[nodeId];
        setSavedContents(nextSaved);
        savedContentsRef.current = nextSaved;
        removeFileEntries(new Set([nodeId]));
        const updatedProject = await syncSharedPackage(sharedProject, nextFiles);
        setSharedProject(updatedProject);
        setSharedFiles(nextFiles);
        sharedFilesRef.current = nextFiles;
        success('File deleted');
        closeDeleteModal();
        await reloadTree();
        return;
      }
      if (meta.kind === 'module') {
        await apiFetch(`/api/modules/${meta.backendId}`, { method: 'DELETE' });
      } else if (meta.kind === 'model') {
        await apiFetch(`/api/models/${meta.backendId}`, { method: 'DELETE' });
      } else {
        await apiFetch(`/api/ui-entities/${meta.backendId}`, { method: 'DELETE' });
      }
      success('File deleted');
    } else {
      if (deleteTarget.scope === 'shared') {
        if (!sharedProject) {
          showError('Shared project is not loaded.');
          return;
        }
        const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
        const removals = sharedFiles.filter((file) =>
          pathStartsWith(splitSharedPath(file.path), deleteTarget.path),
        );
        if (
          removals.some(
            (file) => normalizeSharedPath(file.path) === entryPath,
          )
        ) {
          showError('Cannot delete the folder containing the entry file.');
          return;
        }
        await Promise.all(
          removals.map((file) =>
            adminFetch(
              `${sharedBasePath}/${sharedProject.id}/files/${file.id}`,
              { method: 'DELETE' },
            ),
          ),
        );
        const nextFiles = sharedFiles.filter(
          (file) => !pathStartsWith(splitSharedPath(file.path), deleteTarget.path),
        );
        const nextOverrides = sharedFolderOverrides.filter(
          (path) => !pathStartsWith(path, deleteTarget.path),
        );
        setSharedFolderOverrides(nextOverrides);
        const removeIds = new Set(
          removals.map((file) => getSharedNodeId(file.id)),
        );
        const nextSaved = { ...savedContents };
        removeIds.forEach((id) => delete nextSaved[id]);
        setSavedContents(nextSaved);
        savedContentsRef.current = nextSaved;
        removeFileEntries(removeIds);
        if (nextFiles.length > 0) {
          const updatedProject = await syncSharedPackage(sharedProject, nextFiles);
          setSharedProject(updatedProject);
        }
        setSharedFiles(nextFiles);
        sharedFilesRef.current = nextFiles;
        success('Folder deleted');
        closeDeleteModal();
        await reloadTree();
        return;
      }
      if (deleteTarget.scope === 'modules') {
        if (deleteTarget.path[0] === 'acl') {
          showError('ACL folder cannot be deleted.');
          return;
        }
        const removals = modulesData.filter((mod) =>
          pathStartsWith(splitRoutePath(mod.routePath || '/'), deleteTarget.path),
        );
        await Promise.all(
          removals.map((mod) =>
            apiFetch(`/api/modules/${mod.id}`, { method: 'DELETE' }),
          ),
        );
      } else if (deleteTarget.scope === 'models') {
        const removals = modelsData.filter((model) =>
          pathStartsWith(splitModelPath(model.path || ''), deleteTarget.path),
        );
        await Promise.all(
          removals.map((model) =>
            apiFetch(`/api/models/${model.id}`, { method: 'DELETE' }),
          ),
        );
      } else {
        const removals = uiData.filter((pkg) =>
          pathStartsWith(splitUiName(pkg.name || ''), deleteTarget.path),
        );
        await Promise.all(
          removals.map((pkg) =>
            apiFetch(`/api/ui-entities/${pkg.id}`, { method: 'DELETE' }),
          ),
        );
      }
      const nextOverrides = folderOverrides.filter(
        (item) =>
          item.scope !== deleteTarget.scope ||
          !pathStartsWith(item.path, deleteTarget.path),
      );
      setFolderOverrides(nextOverrides);
      success('Folder deleted');
      closeDeleteModal();
      await loadTree(nextOverrides);
      return;
    }
    closeDeleteModal();
    await loadTree();
  } catch (err) {
    const message = (err as Error).message || 'Failed to delete';
    showError(message);
  }
};
