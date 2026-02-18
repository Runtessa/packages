import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import ExplorerContextMenu from "./file-explorer/ExplorerContextMenu";
import ExplorerTopBar from "./file-explorer/ExplorerTopBar";
import ExplorerTreeList from "./file-explorer/ExplorerTreeList";
import {
  createNodeAction,
  deleteNodeAction,
  performDropAction,
  confirmRenameAction,
  startRenameAction,
} from "./file-explorer/actions";
import {
  buildParentMap,
  findNodeById,
  flattenVisible,
} from "./file-explorer/tree-utils";
import { handleExplorerKeyDown } from "./file-explorer/keyboard";
import useExplorerStorage from "./file-explorer/useExplorerStorage";
import useImportClipboard from "./file-explorer/useImportClipboard";
import useExplorerUiEvents from "./file-explorer/useExplorerUiEvents";
import useExplorerContextMenu from "./file-explorer/useExplorerContextMenu";
import type {
  ContextMenuState,
  DropIndicator,
  DropPosition,
  ExplorerNode,
  FileExplorerProps,
} from "./file-explorer/types";

export type { ExplorerNode, FileExplorerProps } from "./file-explorer/types";
export {
  findNodeById,
  validateUniqueNameAmongSiblings,
  removeNode,
  insertNode,
  renameNode,
  moveNode,
} from "./file-explorer/tree-utils";

export default function FileExplorer({
  onOpenFile,
  initialTree,
  readOnly = false,
  onCreateNode,
  onRenameNode,
  onDeleteNode,
  onMoveNode,
}: FileExplorerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { success, error } = useToast();
  const { tree, setTree, expandedIds, setExpandedIds } = useExplorerStorage(initialTree);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const { copyToClipboard, resolveImportAddress } = useImportClipboard(
    { success, error },
    typeof tree.name === "string" ? tree.name : ""
  );

  useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const parentMap = useMemo(() => buildParentMap(tree), [tree]);
  const visibleNodes = useMemo(() => flattenVisible(tree, expandedIds), [tree, expandedIds]);

  const getParentPath = useCallback(
    (nodeId: string | null) => {
      if (!nodeId) return [];
      const path: ExplorerNode[] = [];
      let currentId = nodeId;
      while (currentId) {
        const current = findNodeById(tree, currentId);
        if (current) {
          path.unshift(current);
        }
        const nextId = parentMap.get(currentId) ?? null;
        if (!nextId) break;
        currentId = nextId;
      }
      return path;
    },
    [parentMap, tree]
  );

  const selectedNode = useMemo(
    () => (selectedId ? findNodeById(tree, selectedId) : null),
    [selectedId, tree]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setRenamingId(null);
    setRenameError(null);
  }, []);

  const startRename = useCallback(
    (id: string) => {
      startRenameAction({
        id,
        readOnly,
        tree,
        parentMap,
        getParentPath,
        onRenameNode,
        setRenamingId,
        setRenameValue,
        setRenameError,
      });
    },
    [getParentPath, onRenameNode, parentMap, readOnly, tree]
  );

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameError(null);
    setRenameValue("");
  }, []);

  const confirmRename = useCallback(() => {
    confirmRenameAction({
      readOnly,
      renamingId,
      renameValue,
      parentMap,
      tree,
      setRenameError,
      setTree,
      setRenamingId,
    });
  }, [parentMap, readOnly, renamingId, renameValue, tree]);

  const createNode = useCallback(
    (type: "file" | "folder") => {
      createNodeAction({
        type,
        readOnly,
        tree,
        selectedId,
        parentMap,
        getParentPath,
        onCreateNode,
        setTree,
        setExpandedIds,
        setSelectedId,
        setRenamingId,
        setRenameValue,
        setRenameError,
      });
    },
    [getParentPath, onCreateNode, parentMap, readOnly, selectedId, tree]
  );

  const handleDelete = useCallback(
    (id: string | null) => {
      deleteNodeAction({
        id,
        readOnly,
        tree,
        parentMap,
        getParentPath,
        selectedId,
        renamingId,
        onDeleteNode,
        setTree,
        setSelectedId,
        cancelRename,
        success,
      });
    },
    [
      cancelRename,
      getParentPath,
      onDeleteNode,
      parentMap,
      readOnly,
      renamingId,
      selectedId,
      tree,
      success,
    ]
  );

  const performDrop = useCallback(
    (targetId: string, position: DropPosition) => {
      performDropAction({
        targetId,
        position,
        readOnly,
        draggingId,
        tree,
        parentMap,
        getParentPath,
        onMoveNode,
        setDraggingId,
        setDropIndicator,
        setTree,
        setExpandedIds,
      });
    },
    [draggingId, getParentPath, onMoveNode, parentMap, readOnly, tree]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      handleExplorerKeyDown(e, {
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
      });
    },
    [
      cancelRename,
      clearSelection,
      contextMenu,
      expandedIds,
      handleDelete,
      onOpenFile,
      parentMap,
      readOnly,
      renamingId,
      selectedId,
      selectedNode,
      startRename,
      toggleExpand,
      visibleNodes,
    ]
  );
  const {
    onContextMenu,
    handleSelectNode,
    handleDragStart,
    handleDragOverNode,
    handleDragLeaveNode,
    handleDropNode,
    handleRenameChange,
  } = useExplorerUiEvents({
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
  });

  const { contextMenuNode, contextMenuImportAddress, expandAll, collapseAll } =
    useExplorerContextMenu({
      contextMenu,
      tree,
      setExpandedIds,
      resolveImportAddress,
    });

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col select-none bg-[#252526] text-gray-100 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => {
        clearSelection();
        setContextMenu(null);
      }}
      onContextMenu={(e) => onContextMenu(e, null)}
    >
      <ExplorerTopBar readOnly={readOnly} onCreateNode={createNode} />

      <ExplorerTreeList
        visibleNodes={visibleNodes}
        selectedId={selectedId}
        expandedIds={expandedIds}
        renamingId={renamingId}
        dropIndicator={dropIndicator}
        readOnly={readOnly}
        renameValue={renameValue}
        renameError={renameError}
        onClearSelection={clearSelection}
        onSelect={handleSelectNode}
        onToggleExpand={toggleExpand}
        onContextMenu={onContextMenu}
        onDragStart={handleDragStart}
        onDragOverNode={handleDragOverNode}
        onDragLeaveNode={handleDragLeaveNode}
        onDropNode={handleDropNode}
        onRenameChange={handleRenameChange}
        onRenameConfirm={confirmRename}
        onRenameCancel={cancelRename}
        onOpenFile={onOpenFile}
      />

      <ExplorerContextMenu
        contextMenu={contextMenu}
        node={contextMenuNode}
        importAddress={contextMenuImportAddress}
        readOnly={readOnly}
        onClose={() => setContextMenu(null)}
        onCreateNode={createNode}
        onRename={startRename}
        onDelete={(nodeId) => handleDelete(nodeId)}
        onCopyImport={(importAddress) => {
          void copyToClipboard(importAddress);
        }}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />
    </div>
  );
}
