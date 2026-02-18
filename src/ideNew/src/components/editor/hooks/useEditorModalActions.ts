import { useCallback } from 'react';
import { useCreateModalActions } from './modal-actions/useCreateModalActions';
import { useEditModalActions } from './modal-actions/useEditModalActions';
import { useRenameDeleteModalActions } from './modal-actions/useRenameDeleteModalActions';
import type { ModalActionsParams } from './modal-actions/types';

export const useEditorModalActions = (params: ModalActionsParams) => {
  const resetActionFeedback = useCallback(() => {}, []);

  const createActions = useCreateModalActions({
    ...params,
    resetActionFeedback,
  });

  const editActions = useEditModalActions({
    ...params,
    resetActionFeedback,
  });

  const renameDeleteActions = useRenameDeleteModalActions({
    ...params,
    resetActionFeedback,
  });

  return {
    resetActionFeedback,
    ...createActions,
    ...editActions,
    ...renameDeleteActions,
  };
};
