import type React from "react";
import type { ContextMenuState, ExplorerNode, FlattenedNode } from "./types";

type HandleExplorerKeyDownParams = {
  contextMenu: ContextMenuState | null;
  setContextMenu: (value: ContextMenuState | null) => void;
  visibleNodes: FlattenedNode[];
  selectedId: string | null;
  setSelectedId: (value: string | null) => void;
  selectedNode: ExplorerNode | null;
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  parentMap: Map<string, string | null>;
  onOpenFile?: (file: ExplorerNode) => void;
  readOnly: boolean;
  startRename: (id: string) => void;
  handleDelete: (id: string | null) => void;
  renamingId: string | null;
  cancelRename: () => void;
  clearSelection: () => void;
};

export const handleExplorerKeyDown = (
  e: React.KeyboardEvent<HTMLDivElement>,
  params: HandleExplorerKeyDownParams
) => {
  const {
    contextMenu,
    setContextMenu,
    visibleNodes,
    selectedId,
    setSelectedId,
    selectedNode,
    expandedIds,
    toggleExpand,
    parentMap,
    onOpenFile,
    readOnly,
    startRename,
    handleDelete,
    renamingId,
    cancelRename,
    clearSelection,
  } = params;

  if (contextMenu) setContextMenu(null);

  const currentIndex = visibleNodes.findIndex((item) => item.node.id === selectedId);
  const selectByIndex = (index: number) => {
    const clamped = Math.max(1, Math.min(visibleNodes.length - 1, index));
    const item = visibleNodes[clamped];
    if (item) setSelectedId(item.node.id);
  };

  switch (e.key) {
    case "ArrowUp":
      e.preventDefault();
      if (currentIndex === -1) {
        if (visibleNodes[1]) setSelectedId(visibleNodes[1].node.id);
      } else if (currentIndex > 1) {
        selectByIndex(currentIndex - 1);
      }
      break;
    case "ArrowDown":
      e.preventDefault();
      if (currentIndex === -1) {
        if (visibleNodes[1]) setSelectedId(visibleNodes[1].node.id);
      } else if (currentIndex < visibleNodes.length - 1) {
        selectByIndex(currentIndex + 1);
      }
      break;
    case "ArrowLeft": {
      e.preventDefault();
      const current = selectedNode;
      if (current && current.type === "folder" && expandedIds.has(current.id)) {
        toggleExpand(current.id);
      } else {
        const parentId = selectedId ? parentMap.get(selectedId) : null;
        if (parentId) setSelectedId(parentId);
      }
      break;
    }
    case "ArrowRight": {
      e.preventDefault();
      const current = selectedNode;
      if (current && current.type === "folder") {
        if (!expandedIds.has(current.id)) {
          toggleExpand(current.id);
        } else if (current.children && current.children.length) {
          setSelectedId(current.children[0].id);
        }
      }
      break;
    }
    case "Enter": {
      const current = selectedNode;
      if (!current) break;
      if (current.type === "folder") {
        toggleExpand(current.id);
      } else {
        onOpenFile?.(current);
      }
      break;
    }
    case "F2":
      if (!readOnly && selectedId) startRename(selectedId);
      break;
    case "Delete":
      if (!readOnly) handleDelete(selectedId);
      break;
    case "Escape":
      if (renamingId) {
        cancelRename();
      } else {
        clearSelection();
        setContextMenu(null);
      }
      break;
    default:
      break;
  }
};
