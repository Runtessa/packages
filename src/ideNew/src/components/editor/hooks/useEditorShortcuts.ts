import { useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ActiveFile } from '@/components/editor/types';

type Params = {
  activeFile: ActiveFile | null;
  handleSaveFile: (file: ActiveFile) => Promise<void> | void;
  handleSaveRef: MutableRefObject<() => void>;
  requestReload: () => void;
  reloadTree: () => Promise<void>;
  loadHistory: () => Promise<void> | void;
};

export const useEditorShortcuts = ({
  activeFile,
  handleSaveFile,
  handleSaveRef,
  requestReload,
  reloadTree,
  loadHistory,
}: Params) => {
  const handleSave = useCallback(() => {
    if (!activeFile) return;
    void handleSaveFile(activeFile);
  }, [activeFile, handleSaveFile]);

  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave, handleSaveRef]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        target &&
        (target.isContentEditable ||
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select')
      ) {
        // Allow modifier shortcuts even while typing, but ignore plain keys.
      }

      const key = event.key.toLowerCase();
      if (key === 'f5') {
        event.preventDefault();
        requestReload();
        return;
      }

      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;

      if (key === 's') {
        event.preventDefault();
        if (activeFile) {
          handleSave();
        }
        return;
      }

      if (key === 'r' && event.shiftKey) {
        event.preventDefault();
        void reloadTree();
        void loadHistory();
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        requestReload();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFile, handleSave, loadHistory, reloadTree, requestReload]);
};
