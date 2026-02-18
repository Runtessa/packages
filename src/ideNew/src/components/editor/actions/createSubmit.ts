import type { Dispatch, SetStateAction } from 'react';
import {
  DEFAULT_CSS_CODE,
  DEFAULT_MODEL_CODE,
  DEFAULT_MODEL_EXTENSION,
  DEFAULT_MODULE_CODE,
  DEFAULT_UI_CODE,
  MODULE_EXTENSION,
} from '@/components/editor/constants';
import { buildExplorerTree, buildSharedTree, coerceUiExtension, compileWithBabel, extractUiDependencies, normalizeModelPath, normalizeSharedPath, resolveSharedExtension } from '@/components/editor/utils';
import type {
  AclConfigDto,
  FolderFormState,
  FolderOverride,
  ModelFormState,
  ModuleDto,
  ModuleFormState,
  OrmModelDto,
  PanelScope,
  SharedFileDto,
  SharedFileFormState,
  SharedProjectDto,
  UIPackageDto,
  UiFormState,
} from '@/components/editor/types';
import type { ExplorerNode } from '@/components/FileExplorer';

type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

type Params = {
  createScope: PanelScope | null;
  createType: 'file' | 'folder' | null;
  sharedProjectId: string | null;
  sharedProject: SharedProjectDto | null;
  sharedFiles: SharedFileDto[];
  sharedFolderOverrides: string[][];
  sharedRootLabel: string;
  sharedMode: 'module' | 'ui' | null;
  createParentPath: string[];
  folderForm: FolderFormState;
  sharedFileForm: SharedFileFormState;
  moduleForm: ModuleFormState;
  modelForm: ModelFormState;
  uiForm: UiFormState;
  modulesData: ModuleDto[];
  modelsData: OrmModelDto[];
  uiData: UIPackageDto[];
  folderOverrides: FolderOverride[];
  aclConfig: AclConfigDto | null;
  sharedBasePath: string;
  adminFetch: FetchFn;
  apiFetch: FetchFn;
  closeCreateModal: () => void;
  loadTree: (folderState?: FolderOverride[]) => Promise<void>;
  reloadTree: () => Promise<void>;
  resetActionFeedback: () => void;
  success: (message: string) => void;
  showError: (message: string) => void;
  setSharedFolderOverrides: Dispatch<SetStateAction<string[][]>>;
  setFolderOverrides: Dispatch<SetStateAction<FolderOverride[]>>;
  setTreeData: Dispatch<SetStateAction<ExplorerNode | null>>;
};

export const submitCreate = async ({
  createScope,
  createType,
  sharedProjectId,
  sharedProject,
  sharedFiles,
  sharedFolderOverrides,
  sharedRootLabel,
  sharedMode,
  createParentPath,
  folderForm,
  sharedFileForm,
  moduleForm,
  modelForm,
  uiForm,
  modulesData,
  modelsData,
  uiData,
  folderOverrides,
  aclConfig,
  sharedBasePath,
  adminFetch,
  apiFetch,
  closeCreateModal,
  loadTree,
  reloadTree,
  resetActionFeedback,
  success,
  showError,
  setSharedFolderOverrides,
  setFolderOverrides,
  setTreeData,
}: Params): Promise<void> => {
  if (!createScope || !createType) return;
  resetActionFeedback();

  if (createScope === 'shared') {
    if (!sharedProjectId) {
      showError('Shared project is not loaded.');
      return;
    }
    if (createType === 'folder') {
      const name = folderForm.name.trim();
      if (!name || /[\\/]/.test(name)) {
        showError('Folder name cannot be empty or contain slashes.');
        return;
      }
      const nextPath = [...createParentPath, name];
      const exists = sharedFolderOverrides.some(
        (item) => item.join('/') === nextPath.join('/'),
      );
      const nextOverrides = exists
        ? sharedFolderOverrides
        : [...sharedFolderOverrides, nextPath];
      setSharedFolderOverrides(nextOverrides);
      if (sharedProject) {
        setTreeData(
          buildSharedTree(sharedProject, sharedFiles, nextOverrides, {
            rootLabel: sharedRootLabel,
            sharedKind: sharedMode ?? undefined,
          }),
        );
      }
      success('Folder created');
      closeCreateModal();
      return;
    }

    const normalizedPath = normalizeSharedPath(sharedFileForm.path);
    if (!normalizedPath) {
      showError('File path is required.');
      return;
    }
    const duplicate = sharedFiles.some(
      (file) => normalizeSharedPath(file.path) === normalizedPath,
    );
    if (duplicate) {
      showError('File already exists at this path.');
      return;
    }
    try {
      const content = sharedFileForm.content ?? '';
      await adminFetch(`${sharedBasePath}/${sharedProjectId}/files`, {
        method: 'POST',
        body: {
          path: normalizedPath,
          content,
          fileExtension: resolveSharedExtension(normalizedPath),
        },
      });
      success('File created');
      closeCreateModal();
      await reloadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to create file';
      showError(message);
    }
    return;
  }

  if (createType === 'folder') {
    const name = folderForm.name.trim();
    if (!name || /[\\/]/.test(name)) {
      showError('Folder name cannot be empty or contain slashes.');
      return;
    }
    const nextPath = [...createParentPath, name];
    const nextOverrides = folderOverrides.some(
      (item) =>
        item.scope === createScope && item.path.join('/') === nextPath.join('/'),
    )
      ? folderOverrides
      : [...folderOverrides, { scope: createScope, path: nextPath }];
    setFolderOverrides(nextOverrides);
    setTreeData(buildExplorerTree(modulesData, uiData, modelsData, nextOverrides, aclConfig));
    success('Folder created');
    closeCreateModal();
    return;
  }

  if (createScope === 'modules') {
    if (!moduleForm.routePath.trim()) {
      showError('Route path is required.');
      return;
    }
    if (!moduleForm.method) {
      showError('Method is required.');
      return;
    }
    try {
      await apiFetch('/api/modules', {
        method: 'POST',
        body: {
          routePath: moduleForm.routePath,
          method: moduleForm.method,
          code: moduleForm.code || DEFAULT_MODULE_CODE,
          fileExtension: MODULE_EXTENSION,
        },
      });
      success('Module created');
      closeCreateModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to create module';
      showError(message);
    }
    return;
  }

  if (createScope === 'models') {
    const normalizedPath = normalizeModelPath(modelForm.path);
    if (!normalizedPath) {
      showError('Model path is required.');
      return;
    }
    try {
      await apiFetch('/api/models', {
        method: 'POST',
        body: {
          path: normalizedPath,
          code: modelForm.code || DEFAULT_MODEL_CODE,
          fileExtension: DEFAULT_MODEL_EXTENSION,
        },
      });
      success('Model created');
      closeCreateModal();
      await loadTree();
    } catch (err) {
      const message = (err as Error).message || 'Failed to create model';
      showError(message);
    }
    return;
  }

  if (!uiForm.name.trim() || !uiForm.version.trim()) {
    showError('Name and version are required.');
    return;
  }
  const uiExtension = coerceUiExtension(uiForm.fileExtension);
  if (uiExtension !== 'css' && !window.Babel) {
    showError('Babel runtime not loaded in browser; cannot build code_blob.');
    return;
  }
  try {
    const fallbackSource = uiExtension === 'css' ? DEFAULT_CSS_CODE : DEFAULT_UI_CODE;
    const sourceCode = uiForm.code || fallbackSource;
    const compiled = uiExtension === 'css' ? sourceCode : compileWithBabel(sourceCode);
    const detectedDependencies = extractUiDependencies(sourceCode);
    await apiFetch('/api/ui-entities', {
      method: 'POST',
      body: {
        name: uiForm.name,
        version: uiForm.version,
        code: sourceCode,
        codeBlob: compiled,
        dependencies: detectedDependencies,
        fileExtension: uiExtension,
      },
    });
    success('UI entity created');
    closeCreateModal();
    await loadTree();
  } catch (err) {
    const message = (err as Error).message || 'Failed to create UI entity';
    showError(message);
  }
};
