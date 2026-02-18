import { useCallback } from 'react';
import { submitDelete } from '@/components/editor/actions/deleteSubmit';
import { submitRenameFolder } from '@/components/editor/actions/renameFolderSubmit';
import type { ModalActionsParams, ModalActionsShared } from './types';

type RenameDeleteParams = Pick<
  ModalActionsParams,
  | 'renameFolderScope'
  | 'renameFolderPath'
  | 'renameFolderName'
  | 'sharedProject'
  | 'sharedFiles'
  | 'sharedFolderOverrides'
  | 'sharedBasePath'
  | 'modulesData'
  | 'modelsData'
  | 'uiData'
  | 'folderOverrides'
  | 'adminFetch'
  | 'apiFetch'
  | 'loadTree'
  | 'reloadTree'
  | 'success'
  | 'showError'
  | 'setSharedFolderOverrides'
  | 'setSharedProject'
  | 'setSharedFiles'
  | 'setFolderOverrides'
  | 'sharedFilesRef'
  | 'syncSharedPackage'
  | 'setRenameFolderOpen'
  | 'setRenameFolderScope'
  | 'setRenameFolderPath'
  | 'setRenameFolderName'
  | 'deleteTarget'
  | 'savedContents'
  | 'removeFileEntries'
  | 'setSavedContents'
  | 'savedContentsRef'
  | 'setDeleteModalOpen'
  | 'setDeleteTarget'
>;

export const useRenameDeleteModalActions = ({
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
  loadTree,
  reloadTree,
  success,
  showError,
  setSharedFolderOverrides,
  setSharedProject,
  setSharedFiles,
  setFolderOverrides,
  sharedFilesRef,
  syncSharedPackage,
  setRenameFolderOpen,
  setRenameFolderScope,
  setRenameFolderPath,
  setRenameFolderName,
  deleteTarget,
  savedContents,
  removeFileEntries,
  setSavedContents,
  savedContentsRef,
  setDeleteModalOpen,
  setDeleteTarget,
  resetActionFeedback,
}: RenameDeleteParams & ModalActionsShared) => {
  const openRenameFolderModal = useCallback(
    (scope: 'modules' | 'models' | 'ui' | 'shared', path: string[]) => {
      resetActionFeedback();
      const name = path[path.length - 1] || '';
      setRenameFolderScope(scope);
      setRenameFolderPath(path);
      setRenameFolderName(name);
      setRenameFolderOpen(true);
    },
    [
      resetActionFeedback,
      setRenameFolderName,
      setRenameFolderOpen,
      setRenameFolderPath,
      setRenameFolderScope,
    ],
  );

  const closeRenameFolderModal = useCallback(() => {
    setRenameFolderOpen(false);
    setRenameFolderScope(null);
    setRenameFolderPath([]);
    setRenameFolderName('');
  }, [
    setRenameFolderName,
    setRenameFolderOpen,
    setRenameFolderPath,
    setRenameFolderScope,
  ]);

  const handleRenameFolderSubmit = useCallback(async () => {
    await submitRenameFolder({
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
    });
  }, [
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
  ]);

  const openDeleteModal = useCallback(
    (target: NonNullable<RenameDeleteParams['deleteTarget']>) => {
      resetActionFeedback();
      setDeleteTarget(target);
      setDeleteModalOpen(true);
    },
    [resetActionFeedback, setDeleteModalOpen, setDeleteTarget],
  );

  const closeDeleteModal = useCallback(() => {
    setDeleteModalOpen(false);
    setDeleteTarget(null);
  }, [setDeleteModalOpen, setDeleteTarget]);

  const handleDeleteSubmit = useCallback(async () => {
    await submitDelete({
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
    });
  }, [
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
  ]);

  return {
    openRenameFolderModal,
    closeRenameFolderModal,
    handleRenameFolderSubmit,
    openDeleteModal,
    closeDeleteModal,
    handleDeleteSubmit,
  };
};
