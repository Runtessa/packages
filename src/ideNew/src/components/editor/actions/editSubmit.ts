import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { DEFAULT_MODEL_EXTENSION, MODULE_EXTENSION } from '@/components/editor/constants';
import { coerceUiExtension, normalizeModelPath, normalizeSharedPath, parseDependencies, resolveSharedExtension } from '@/components/editor/utils';
import type {
  ModelFormState,
  ModuleFormState,
  NodeMeta,
  SharedFileDto,
  SharedProjectDto,
  UiFormState,
} from '@/components/editor/types';

type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

type Params = {
  editMeta: NodeMeta | null;
  editSharedPath: string;
  editModuleForm: ModuleFormState;
  editModelForm: ModelFormState;
  editUiForm: UiFormState;
  sharedProject: SharedProjectDto | null;
  sharedFiles: SharedFileDto[];
  sharedBasePath: string;
  adminFetch: FetchFn;
  apiFetch: FetchFn;
  closeEditModal: () => void;
  loadTree: () => Promise<void>;
  reloadTree: () => Promise<void>;
  resetActionFeedback: () => void;
  success: (message: string) => void;
  showError: (message: string) => void;
  setSharedProject: Dispatch<SetStateAction<SharedProjectDto | null>>;
  setSharedFiles: Dispatch<SetStateAction<SharedFileDto[]>>;
  sharedFilesRef: MutableRefObject<SharedFileDto[]>;
  syncSharedPackage: (
    project: SharedProjectDto,
    files: SharedFileDto[],
    entryPathOverride?: string
  ) => Promise<SharedProjectDto>;
};

export const submitEdit = async ({
  editMeta,
  editSharedPath,
  editModuleForm,
  editModelForm,
  editUiForm,
  sharedProject,
  sharedFiles,
  sharedBasePath,
  adminFetch,
  apiFetch,
  closeEditModal,
  loadTree,
  reloadTree,
  resetActionFeedback,
  success,
  showError,
  setSharedProject,
  setSharedFiles,
  sharedFilesRef,
  syncSharedPackage,
}: Params): Promise<void> => {
  if (!editMeta) return;
  resetActionFeedback();

  if (editMeta.kind === 'shared') {
    if (!sharedProject) {
      showError('Shared project is not loaded.');
      return;
    }
    const normalizedPath = normalizeSharedPath(editSharedPath);
    if (!normalizedPath) {
      showError('File path is required.');
      return;
    }
    const duplicate = sharedFiles.some(
      (file) =>
        file.id !== editMeta.fileId &&
        normalizeSharedPath(file.path) === normalizedPath,
    );
    if (duplicate) {
      showError('File already exists at this path.');
      return;
    }
    try {
      await adminFetch(
        `${sharedBasePath}/${sharedProject.id}/files/${editMeta.fileId}`,
        {
          method: 'PUT',
          body: {
            path: normalizedPath,
            fileExtension: resolveSharedExtension(
              normalizedPath,
              editMeta.fileExtension,
            ),
          },
        },
      );
      const nextFiles = sharedFiles.map((file) =>
        file.id === editMeta.fileId ? { ...file, path: normalizedPath } : file,
      );
      const entryPath = normalizeSharedPath(sharedProject.entryPath || '');
      const nextProject =
        normalizeSharedPath(editMeta.path) === entryPath
          ? { ...sharedProject, entryPath: normalizedPath }
          : sharedProject;
      const updatedProject = await syncSharedPackage(nextProject, nextFiles);
      setSharedProject(updatedProject);
      setSharedFiles(nextFiles);
      sharedFilesRef.current = nextFiles;
      success('File updated');
      closeEditModal();
      await reloadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to update file';
      showError(message);
    }
    return;
  }

  if (editMeta.kind === 'module') {
    if (!editModuleForm.routePath.trim()) {
      showError('Route path is required.');
      return;
    }
    if (!editModuleForm.method) {
      showError('Method is required.');
      return;
    }
    try {
      await apiFetch(`/api/modules/${editMeta.backendId}`, {
        method: 'PUT',
        body: {
          routePath: editModuleForm.routePath,
          method: editModuleForm.method,
          fileExtension: MODULE_EXTENSION,
        },
      });
      success('Module updated');
      closeEditModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to update module';
      showError(message);
    }
    return;
  }

  if (editMeta.kind === 'model') {
    const normalizedPath = normalizeModelPath(editModelForm.path);
    if (!normalizedPath) {
      showError('Model path is required.');
      return;
    }
    try {
      await apiFetch(`/api/models/${editMeta.backendId}`, {
        method: 'PUT',
        body: {
          path: normalizedPath,
          fileExtension: DEFAULT_MODEL_EXTENSION,
        },
      });
      success('Model updated');
      closeEditModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to update model';
      showError(message);
    }
    return;
  }

  if (!editUiForm.name.trim() || !editUiForm.version.trim()) {
    showError('Name and version are required.');
    return;
  }
  if (editMeta.kind !== 'ui') {
    showError('Selected item is not a UI entity.');
    return;
  }
  try {
    const uiExtension = coerceUiExtension(editUiForm.fileExtension);
    await apiFetch(`/api/ui-entities/${editMeta.backendId}`, {
      method: 'PUT',
      body: {
        name: editUiForm.name,
        version: editUiForm.version,
        dependencies: parseDependencies(editUiForm.dependencies),
        fileExtension: uiExtension,
      },
    });
    success('UI entity updated');
    closeEditModal();
    await loadTree();
  } catch (err) {
    const message = (err as Error).message || 'Failed to update UI entity';
    showError(message);
  }
};
