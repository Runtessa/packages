import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveFile } from '@/components/editor/types';

type Params = {
  pendingCloseBusy: boolean;
  pendingCloseIds: string[];
  pendingCloseAction: 'close' | 'reload' | null;
  pendingDirtyFiles: ActiveFile[];
  handleSaveFile: (file: ActiveFile) => Promise<void> | void;
  closeTabsByIds: (ids: Set<string>) => void;
  requestCloseTabs: (ids: Set<string>) => void;
  setClosePromptOpen: Dispatch<SetStateAction<boolean>>;
  setPendingCloseIds: Dispatch<SetStateAction<string[]>>;
  setPendingCloseAction: Dispatch<SetStateAction<'close' | 'reload' | null>>;
  setPendingCloseBusy: Dispatch<SetStateAction<boolean>>;
};

export const useEditorClosePrompt = ({
  pendingCloseBusy,
  pendingCloseIds,
  pendingCloseAction,
  pendingDirtyFiles,
  handleSaveFile,
  closeTabsByIds,
  requestCloseTabs,
  setClosePromptOpen,
  setPendingCloseIds,
  setPendingCloseAction,
  setPendingCloseBusy,
}: Params) => {
  const handleCancelClosePrompt = useCallback(() => {
    if (pendingCloseBusy) return;
    setClosePromptOpen(false);
    setPendingCloseIds([]);
    setPendingCloseAction(null);
  }, [pendingCloseBusy, setClosePromptOpen, setPendingCloseAction, setPendingCloseIds]);

  const handleDiscardClosePrompt = useCallback(() => {
    if (pendingCloseBusy) return;
    if (pendingCloseAction === 'reload') {
      setPendingCloseIds([]);
      setPendingCloseAction(null);
      setClosePromptOpen(false);
      window.location.reload();
      return;
    }
    closeTabsByIds(new Set(pendingCloseIds));
    setPendingCloseIds([]);
    setPendingCloseAction(null);
    setClosePromptOpen(false);
  }, [
    closeTabsByIds,
    pendingCloseAction,
    pendingCloseBusy,
    pendingCloseIds,
    setClosePromptOpen,
    setPendingCloseAction,
    setPendingCloseIds,
  ]);

  const handleSaveClosePrompt = useCallback(async () => {
    if (pendingCloseBusy) return;
    setPendingCloseBusy(true);
    for (const file of pendingDirtyFiles) {
      await handleSaveFile(file);
    }
    if (pendingCloseAction === 'reload') {
      setPendingCloseIds([]);
      setPendingCloseAction(null);
      setClosePromptOpen(false);
      setPendingCloseBusy(false);
      window.location.reload();
      return;
    }
    closeTabsByIds(new Set(pendingCloseIds));
    setPendingCloseIds([]);
    setPendingCloseAction(null);
    setClosePromptOpen(false);
    setPendingCloseBusy(false);
  }, [
    closeTabsByIds,
    handleSaveFile,
    pendingCloseAction,
    pendingCloseBusy,
    pendingCloseIds,
    pendingDirtyFiles,
    setClosePromptOpen,
    setPendingCloseAction,
    setPendingCloseBusy,
    setPendingCloseIds,
  ]);

  const handleCloseFile = useCallback(
    (id: string) => {
      requestCloseTabs(new Set([id]));
    },
    [requestCloseTabs],
  );

  return {
    handleCancelClosePrompt,
    handleDiscardClosePrompt,
    handleSaveClosePrompt,
    handleCloseFile,
  };
};
