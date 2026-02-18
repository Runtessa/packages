import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PreviewTarget, SharedProjectDto, UIPackageDto } from '@/components/editor/types';
import type { AssistantDiffPreview } from '@/components/editor/page-types';

type Params = {
  isSharedMode: boolean;
  sharedProject: SharedProjectDto | null;
  previewTarget: PreviewTarget | null;
  uiData: UIPackageDto[];
  loadHistory: () => Promise<void> | void;
  reloadTree: () => Promise<void>;
  success: (message: string) => void;
  setEditorView: Dispatch<SetStateAction<'code' | 'preview'>>;
  setPreviewTarget: Dispatch<SetStateAction<PreviewTarget | null>>;
  setPreviewNonce: Dispatch<SetStateAction<number>>;
  setHistorySelectedId: Dispatch<SetStateAction<string | null>>;
  setAssistantDiff: Dispatch<SetStateAction<AssistantDiffPreview | null>>;
};

export const useEditorPreviewActions = ({
  isSharedMode,
  sharedProject,
  previewTarget,
  uiData,
  loadHistory,
  reloadTree,
  success,
  setEditorView,
  setPreviewTarget,
  setPreviewNonce,
  setHistorySelectedId,
  setAssistantDiff,
}: Params) => {
  const handleSwitchToPreview = useCallback(() => {
    if (isSharedMode && sharedProject) {
      setPreviewTarget({
        kind: 'shared',
        name: sharedProject.name,
        version: sharedProject.version,
      });
    } else if (!isSharedMode && !previewTarget && uiData.length > 0) {
      const first = uiData[0];
      if (first?.name && first?.version) {
        setPreviewTarget({ kind: 'ui', name: first.name, version: first.version });
      }
    }
    setEditorView('preview');
  }, [isSharedMode, previewTarget, setEditorView, setPreviewTarget, sharedProject, uiData]);

  const handleRefreshPreview = useCallback(() => {
    setPreviewNonce((prev) => prev + 1);
  }, [setPreviewNonce]);

  const refreshWorkspace = useCallback(() => {
    void reloadTree();
    void loadHistory();
  }, [loadHistory, reloadTree]);

  const openAssistantDiffPreview = useCallback(
    (payload: {
      path: string;
      before: string;
      after: string;
      language: string;
    }) => {
      const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setHistorySelectedId(null);
      setAssistantDiff({
        id: `assistant-${seed}`,
        path: payload.path,
        before: payload.before,
        after: payload.after,
        language: payload.language || 'plaintext',
      });
      setEditorView('code');
      success(`Opened diff: ${payload.path}`);
    },
    [setAssistantDiff, setEditorView, setHistorySelectedId, success],
  );

  return {
    handleSwitchToPreview,
    handleRefreshPreview,
    refreshWorkspace,
    openAssistantDiffPreview,
  };
};
