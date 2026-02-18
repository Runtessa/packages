import { useCallback } from 'react';
import { DEFAULT_MODEL_EXTENSION } from '@/components/editor/constants';
import { coerceModuleExtension, coerceUiExtension } from '@/components/editor/utils';
import { submitEdit } from '@/components/editor/actions/editSubmit';
import type { ModalActionsParams, ModalActionsShared } from './types';

type EditParams = Pick<
  ModalActionsParams,
  | 'editMeta'
  | 'editSharedPath'
  | 'editModuleForm'
  | 'editModelForm'
  | 'editUiForm'
  | 'sharedProject'
  | 'sharedFiles'
  | 'sharedBasePath'
  | 'adminFetch'
  | 'apiFetch'
  | 'loadTree'
  | 'reloadTree'
  | 'success'
  | 'showError'
  | 'setSharedProject'
  | 'setSharedFiles'
  | 'sharedFilesRef'
  | 'syncSharedPackage'
  | 'setEditModalOpen'
  | 'setEditMeta'
  | 'setEditSharedPath'
  | 'setEditModuleForm'
  | 'setEditModelForm'
  | 'setEditUiForm'
>;

export const useEditModalActions = ({
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
  loadTree,
  reloadTree,
  success,
  showError,
  setSharedProject,
  setSharedFiles,
  sharedFilesRef,
  syncSharedPackage,
  setEditModalOpen,
  setEditMeta,
  setEditSharedPath,
  setEditModuleForm,
  setEditModelForm,
  setEditUiForm,
  resetActionFeedback,
}: EditParams & ModalActionsShared) => {
  const openEditModal = useCallback(
    (meta: NonNullable<EditParams['editMeta']>) => {
      resetActionFeedback();
      if (meta.kind === 'acl') {
        showError('ACL files cannot be edited from metadata.');
        return;
      }
      setEditMeta(meta);
      if (meta.kind === 'shared') {
        setEditSharedPath(meta.path);
      } else if (meta.kind === 'module') {
        setEditModuleForm({
          routePath: meta.routePath,
          method: meta.method,
          fileExtension: coerceModuleExtension(meta.fileExtension),
          code: '',
        });
      } else if (meta.kind === 'model') {
        setEditModelForm({
          path: meta.path,
          fileExtension: meta.fileExtension || DEFAULT_MODEL_EXTENSION,
          code: '',
        });
      } else {
        setEditUiForm({
          name: meta.name,
          version: meta.version,
          fileExtension: coerceUiExtension(meta.fileExtension),
          dependencies: (meta.dependencies || []).join(', '),
          code: '',
        });
      }
      setEditModalOpen(true);
    },
    [
      resetActionFeedback,
      setEditMeta,
      setEditModalOpen,
      setEditModelForm,
      setEditModuleForm,
      setEditSharedPath,
      setEditUiForm,
      showError,
    ],
  );

  const closeEditModal = useCallback(() => {
    setEditModalOpen(false);
    setEditMeta(null);
    setEditSharedPath('');
  }, [setEditMeta, setEditModalOpen, setEditSharedPath]);

  const handleEditSubmit = useCallback(async () => {
    await submitEdit({
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
    });
  }, [
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
  ]);

  return {
    openEditModal,
    closeEditModal,
    handleEditSubmit,
  };
};
