import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ActiveFile } from '@/components/editor/types';

type Params = {
  dragTabIdRef: MutableRefObject<string | null>;
  editorAreaRef: MutableRefObject<HTMLDivElement | null>;
  setEditorDropTarget: Dispatch<SetStateAction<'left' | 'right' | null>>;
  setOpenFiles: Dispatch<SetStateAction<ActiveFile[]>>;
  moveTabToPane: (fileId: string, pane: 'left' | 'right') => void;
};

export const useEditorTabDragDrop = ({
  dragTabIdRef,
  editorAreaRef,
  setEditorDropTarget,
  setOpenFiles,
  moveTabToPane,
}: Params) => {
  const getDraggedTabId = useCallback(
    (event: React.DragEvent<HTMLDivElement>) =>
      dragTabIdRef.current ||
      event.dataTransfer.getData('application/x-editor-tab') ||
      event.dataTransfer.getData('text/plain'),
    [dragTabIdRef],
  );

  const handleTabDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, id: string) => {
      dragTabIdRef.current = id;
      event.dataTransfer.setData('application/x-editor-tab', id);
      event.dataTransfer.setData('text/plain', '');
      event.dataTransfer.effectAllowed = 'move';
    },
    [dragTabIdRef],
  );

  const handleTabDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleEditorDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = getDraggedTabId(event);
      if (!sourceId || !editorAreaRef.current) {
        setEditorDropTarget(null);
        return;
      }
      const rect = editorAreaRef.current.getBoundingClientRect();
      const isRightSide = event.clientX > rect.left + rect.width * 0.55;
      setEditorDropTarget(isRightSide ? 'right' : 'left');
      event.dataTransfer.dropEffect = 'move';
    },
    [editorAreaRef, getDraggedTabId, setEditorDropTarget],
  );

  const handleEditorDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (editorAreaRef.current && next && editorAreaRef.current.contains(next)) {
        return;
      }
      setEditorDropTarget(null);
    },
    [editorAreaRef, setEditorDropTarget],
  );

  const handleTabDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, id: string, pane: 'left' | 'right') => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = getDraggedTabId(event);
      dragTabIdRef.current = null;
      if (!sourceId || sourceId === id) return;
      setOpenFiles((prev) => {
        const fromIndex = prev.findIndex((file) => file.id === sourceId);
        const toIndex = prev.findIndex((file) => file.id === id);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
      moveTabToPane(sourceId, pane);
    },
    [dragTabIdRef, getDraggedTabId, moveTabToPane, setOpenFiles],
  );

  const handleTabDragEnd = useCallback(() => {
    dragTabIdRef.current = null;
    setEditorDropTarget(null);
  }, [dragTabIdRef, setEditorDropTarget]);

  const handleTabBarDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, pane: 'left' | 'right') => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = getDraggedTabId(event);
      dragTabIdRef.current = null;
      if (!sourceId) return;
      moveTabToPane(sourceId, pane);
    },
    [dragTabIdRef, getDraggedTabId, moveTabToPane],
  );

  const handleEditorDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const sourceId = getDraggedTabId(event);
      dragTabIdRef.current = null;
      setEditorDropTarget(null);
      if (!sourceId || !editorAreaRef.current) return;
      const rect = editorAreaRef.current.getBoundingClientRect();
      const isRightSide = event.clientX > rect.left + rect.width * 0.55;
      moveTabToPane(sourceId, isRightSide ? 'right' : 'left');
    },
    [dragTabIdRef, editorAreaRef, getDraggedTabId, moveTabToPane, setEditorDropTarget],
  );

  return {
    handleTabDragStart,
    handleTabDragOver,
    handleEditorDragOver,
    handleEditorDragLeave,
    handleTabDrop,
    handleTabDragEnd,
    handleTabBarDrop,
    handleEditorDrop,
  };
};
