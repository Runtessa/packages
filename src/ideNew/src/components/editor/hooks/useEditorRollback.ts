import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ActiveFile, ModuleDto, UIPackageDto } from '@/components/editor/types';

type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

type Params = {
  activeFile: ActiveFile | null;
  apiFetch: FetchFn;
  reloadTree: () => Promise<void>;
  loadHistory: () => Promise<void> | void;
  success: (message: string) => void;
  showError: (message: string) => void;
  setFileContents: Dispatch<SetStateAction<Record<string, string>>>;
  setSavedContents: Dispatch<SetStateAction<Record<string, string>>>;
};

export const useEditorRollback = ({
  activeFile,
  apiFetch,
  reloadTree,
  loadHistory,
  success,
  showError,
  setFileContents,
  setSavedContents,
}: Params) => {
  return useCallback(
    async (revisionId: string) => {
      if (!activeFile?.meta) return;
      try {
        if (activeFile.meta.kind === 'module') {
          const updated = (await apiFetch(
            `/api/modules/${activeFile.meta.backendId}/rollback/${revisionId}`,
            { method: 'POST' },
          )) as ModuleDto;
          const rolledContent = updated.code ?? '';
          setFileContents((prev) => ({ ...prev, [activeFile.id]: rolledContent }));
          setSavedContents((prev) => ({ ...prev, [activeFile.id]: rolledContent }));
        } else if (activeFile.meta.kind === 'ui') {
          const updated = (await apiFetch(
            `/api/ui-entities/${activeFile.meta.backendId}/rollback/${revisionId}`,
            { method: 'POST' },
          )) as UIPackageDto;
          const rolledContent = updated.code ?? updated.codeBlob ?? '';
          setFileContents((prev) => ({ ...prev, [activeFile.id]: rolledContent }));
          setSavedContents((prev) => ({ ...prev, [activeFile.id]: rolledContent }));
        } else {
          showError('Rollback is not available for shared projects yet.');
          return;
        }
        success('Rolled back');
        await reloadTree();
        await loadHistory();
      } catch (err) {
        const message = (err as Error).message || 'Rollback failed';
        showError(message);
      }
    },
    [
      activeFile,
      apiFetch,
      loadHistory,
      reloadTree,
      setFileContents,
      setSavedContents,
      showError,
      success,
    ],
  );
};
