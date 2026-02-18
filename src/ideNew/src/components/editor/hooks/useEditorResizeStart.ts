import { useCallback } from 'react';
import type { MutableRefObject } from 'react';

type Params = {
  leftPanelWidthRef: MutableRefObject<number>;
  resizeRef: MutableRefObject<{ active: boolean; startX: number; startWidth: number }>;
  assistantPanelWidthRef: MutableRefObject<number>;
  assistantResizeRef: MutableRefObject<{ active: boolean; startX: number; startWidth: number }>;
  splitResizeRef: MutableRefObject<{ active: boolean }>;
};

export const useEditorResizeStart = ({
  leftPanelWidthRef,
  resizeRef,
  assistantPanelWidthRef,
  assistantResizeRef,
  splitResizeRef,
}: Params) => {
  const handleResizeStart = useCallback(
    (event: React.MouseEvent) => {
      resizeRef.current = {
        active: true,
        startX: event.clientX,
        startWidth: leftPanelWidthRef.current,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [leftPanelWidthRef, resizeRef],
  );

  const handleAssistantResizeStart = useCallback(
    (event: React.MouseEvent) => {
      assistantResizeRef.current = {
        active: true,
        startX: event.clientX,
        startWidth: assistantPanelWidthRef.current,
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [assistantPanelWidthRef, assistantResizeRef],
  );

  const handleSplitResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      splitResizeRef.current.active = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [splitResizeRef],
  );

  return {
    handleResizeStart,
    handleAssistantResizeStart,
    handleSplitResizeStart,
  };
};
