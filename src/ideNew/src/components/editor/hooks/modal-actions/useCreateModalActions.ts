import { useCallback } from 'react';
import {
  DEFAULT_MODEL_CODE,
  DEFAULT_MODEL_EXTENSION,
  DEFAULT_MODULE_CODE,
  DEFAULT_SHARED_FILE,
  DEFAULT_UI_CODE,
  DEFAULT_UI_EXTENSION,
  MODULE_EXTENSION,
} from '@/components/editor/constants';
import { buildRoutePath, normalizeModelPath } from '@/components/editor/utils';
import { submitCreate } from '@/components/editor/actions/createSubmit';
import type { ModalActionsParams, ModalActionsShared } from './types';

type CreateParams = Pick<
  ModalActionsParams,
  | 'apiFetch'
  | 'adminFetch'
  | 'loadTree'
  | 'reloadTree'
  | 'success'
  | 'showError'
  | 'sharedBasePath'
  | 'sharedRootLabel'
  | 'sharedMode'
  | 'sharedProjectId'
  | 'sharedProject'
  | 'sharedFiles'
  | 'sharedFolderOverrides'
  | 'modulesData'
  | 'modelsData'
  | 'uiData'
  | 'folderOverrides'
  | 'aclConfig'
  | 'createScope'
  | 'createType'
  | 'createParentPath'
  | 'folderForm'
  | 'moduleForm'
  | 'modelForm'
  | 'uiForm'
  | 'sharedFileForm'
  | 'setCreateModalOpen'
  | 'setCreateScope'
  | 'setCreateType'
  | 'setCreateParentPath'
  | 'setFolderForm'
  | 'setSharedFileForm'
  | 'setModuleForm'
  | 'setModelForm'
  | 'setUiForm'
  | 'setSharedFolderOverrides'
  | 'setFolderOverrides'
  | 'setTreeData'
>;

export const useCreateModalActions = ({
  apiFetch,
  adminFetch,
  loadTree,
  reloadTree,
  success,
  showError,
  sharedBasePath,
  sharedRootLabel,
  sharedMode,
  sharedProjectId,
  sharedProject,
  sharedFiles,
  sharedFolderOverrides,
  modulesData,
  modelsData,
  uiData,
  folderOverrides,
  aclConfig,
  createScope,
  createType,
  createParentPath,
  folderForm,
  moduleForm,
  modelForm,
  uiForm,
  sharedFileForm,
  setCreateModalOpen,
  setCreateScope,
  setCreateType,
  setCreateParentPath,
  setFolderForm,
  setSharedFileForm,
  setModuleForm,
  setModelForm,
  setUiForm,
  setSharedFolderOverrides,
  setFolderOverrides,
  setTreeData,
  resetActionFeedback,
}: CreateParams & ModalActionsShared) => {
  const createDefaultModel = useCallback(
    async (parentPath: string[]) => {
      const prefix = parentPath.length ? `${parentPath.join('/')}/` : '';
      const existing = new Set(
        modelsData.map((model) => normalizeModelPath(model.path)).filter(Boolean),
      );
      let candidate = normalizeModelPath(`${prefix}NewModel.js`);
      let counter = 2;
      while (existing.has(candidate)) {
        candidate = normalizeModelPath(`${prefix}NewModel${counter}.js`);
        counter += 1;
      }
      try {
        await apiFetch('/api/models', {
          method: 'POST',
          body: {
            path: candidate,
            code: DEFAULT_MODEL_CODE,
            fileExtension: DEFAULT_MODEL_EXTENSION,
          },
        });
        success('Model created');
        await loadTree();
      } catch (err) {
        const message = (err as Error).message || 'Failed to create model';
        showError(message);
      }
    },
    [apiFetch, loadTree, modelsData, showError, success],
  );

  const openCreateModal = useCallback(
    (scope: 'modules' | 'models' | 'ui' | 'shared', type: 'file' | 'folder', parentPath: string[]) => {
      resetActionFeedback();
      if (scope === 'modules' && parentPath[0] === 'acl') {
        showError('ACL folder is read-only.');
        return;
      }
      if (scope === 'models' && type === 'file') {
        void createDefaultModel(parentPath);
        return;
      }
      setCreateScope(scope);
      setCreateType(type);
      setCreateParentPath(parentPath);
      if (scope === 'shared') {
        if (type === 'file') {
          const ext = sharedProject?.fileExtension || 'jsx';
          const base = parentPath.length ? `${parentPath.join('/')}/` : '';
          setSharedFileForm({ path: `${base}new-file.${ext}`, content: '' });
        } else {
          setFolderForm({ name: '' });
        }
        setCreateModalOpen(true);
        return;
      }
      if (type === 'file') {
        if (scope === 'modules') {
          const routePath = buildRoutePath(parentPath);
          setModuleForm({
            routePath,
            method: 'GET',
            fileExtension: MODULE_EXTENSION,
            code: DEFAULT_MODULE_CODE,
          });
        } else if (scope === 'models') {
          const prefix = parentPath.length ? `${parentPath.join('/')}/` : '';
          setModelForm({
            path: normalizeModelPath(`${prefix}ExampleItem.js`),
            fileExtension: DEFAULT_MODEL_EXTENSION,
            code: DEFAULT_MODEL_CODE,
          });
        } else {
          const prefix = parentPath.length ? `${parentPath.join('/')}/` : '';
          setUiForm({
            name: `${prefix}NewComponent`,
            version: '1.0.0',
            fileExtension: DEFAULT_UI_EXTENSION,
            dependencies: '',
            code: DEFAULT_UI_CODE,
          });
        }
      } else {
        setFolderForm({ name: '' });
      }
      setCreateModalOpen(true);
    },
    [
      createDefaultModel,
      resetActionFeedback,
      setCreateModalOpen,
      setCreateParentPath,
      setCreateScope,
      setCreateType,
      setFolderForm,
      setModelForm,
      setModuleForm,
      setSharedFileForm,
      setUiForm,
      sharedProject?.fileExtension,
      showError,
    ],
  );

  const closeCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setCreateScope(null);
    setCreateType(null);
    setCreateParentPath([]);
    setFolderForm({ name: '' });
    setSharedFileForm(DEFAULT_SHARED_FILE);
    setModelForm({
      path: 'models/ExampleItem.js',
      fileExtension: DEFAULT_MODEL_EXTENSION,
      code: DEFAULT_MODEL_CODE,
    });
  }, [
    setCreateModalOpen,
    setCreateParentPath,
    setCreateScope,
    setCreateType,
    setFolderForm,
    setModelForm,
    setSharedFileForm,
  ]);

  const handleCreateSubmit = useCallback(async () => {
    await submitCreate({
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
    });
  }, [
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
  ]);

  return {
    openCreateModal,
    closeCreateModal,
    handleCreateSubmit,
  };
};
