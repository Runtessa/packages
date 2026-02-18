import { useCallback, type DragEvent, type MouseEvent } from "react";
import { containsId, dropPositionFromPointer, findNodeById } from "./tree-utils";
import type { DropPosition, ExplorerNode } from "./types";

type UseExplorerUiEventsParams = {
  tree: ExplorerNode;
  draggingId: string | null;
  setDraggingId: (value: string | null) => void;
  setDropIndicator: (value: { id: string; position: DropPosition } | null) => void;
  setContextMenu: (value: { x: number; y: number; nodeId: string | null } | null) => void;
  setSelectedId: (value: string | null) => void;
  onOpenFile?: (file: ExplorerNode) => void;
  performDrop: (targetId: string, position: DropPosition) => void;
  setRenameValue: (value: string) => void;
  setRenameError: (value: string | null) => void;
};

const useExplorerUiEvents = ({
  tree,
  draggingId,
  setDraggingId,
  setDropIndicator,
  setContextMenu,
  setSelectedId,
  onOpenFile,
  performDrop,
  setRenameValue,
  setRenameError,
}: UseExplorerUiEventsParams) => {
  const onContextMenu = useCallback(
    (e: MouseEvent, nodeId: string | null) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId,
      });
      if (nodeId) setSelectedId(nodeId);
    },
    [setContextMenu, setSelectedId]
  );

  const handleSelectNode = useCallback(
    (node: ExplorerNode, isRenaming: boolean) => {
      setSelectedId(node.id);
      setContextMenu(null);
      if (node.type === "file" && !isRenaming) {
        onOpenFile?.(node);
      }
    },
    [onOpenFile, setContextMenu, setSelectedId]
  );

  const handleDragStart = useCallback(
    (id: string) => {
      setDraggingId(id);
      setDropIndicator(null);
    },
    [setDraggingId, setDropIndicator]
  );

  const handleDragOverNode = useCallback(
    (node: ExplorerNode, e: DragEvent<HTMLDivElement>, ref: HTMLDivElement | null) => {
      if (!draggingId || draggingId === node.id) return;
      const position = dropPositionFromPointer(e, node, ref);
      const draggingNode = draggingId ? findNodeById(tree, draggingId) : null;
      if (draggingNode && draggingNode.type === "folder" && containsId(draggingNode, node.id)) {
        setDropIndicator(null);
        return;
      }
      setDropIndicator({ id: node.id, position });
    },
    [draggingId, setDropIndicator, tree]
  );

  const handleDragLeaveNode = useCallback(() => setDropIndicator(null), [setDropIndicator]);

  const handleDropNode = useCallback(
    (targetId: string, position: DropPosition) => {
      setDropIndicator(null);
      performDrop(targetId, position);
    },
    [performDrop, setDropIndicator]
  );

  const handleRenameChange = useCallback(
    (value: string) => {
      setRenameValue(value);
      setRenameError(null);
    },
    [setRenameError, setRenameValue]
  );

  return {
    onContextMenu,
    handleSelectNode,
    handleDragStart,
    handleDragOverNode,
    handleDragLeaveNode,
    handleDropNode,
    handleRenameChange,
  };
};

export default useExplorerUiEvents;
