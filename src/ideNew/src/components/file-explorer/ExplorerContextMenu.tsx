import React from "react";
import type { ContextMenuState, ExplorerNode } from "./types";

type ExplorerContextMenuProps = {
  contextMenu: ContextMenuState | null;
  node: ExplorerNode | null;
  importAddress: string | null;
  readOnly: boolean;
  onClose: () => void;
  onCreateNode: (type: "file" | "folder") => void;
  onRename: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onCopyImport: (importAddress: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

const ExplorerContextMenu = ({
  contextMenu,
  node,
  importAddress,
  readOnly,
  onClose,
  onCreateNode,
  onRename,
  onDelete,
  onCopyImport,
  onExpandAll,
  onCollapseAll,
}: ExplorerContextMenuProps) => {
  if (!contextMenu) return null;

  const isRoot = node?.id === "root";

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded border border-[#2a2d2e] bg-[#252526] text-sm text-gray-200 shadow-lg"
      style={{ top: contextMenu.y, left: contextMenu.x }}
      onClick={(e) => e.stopPropagation()}
    >
      {!readOnly && (
        <>
          <button
            className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
            onClick={() => {
              onCreateNode("file");
              onClose();
            }}
          >
            New File
          </button>
          <button
            className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
            onClick={() => {
              onCreateNode("folder");
              onClose();
            }}
          >
            New Folder
          </button>
        </>
      )}

      {node && !isRoot && !readOnly && (
        <>
          <button
            className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
            onClick={() => {
              onRename(node.id);
              onClose();
            }}
          >
            Rename
          </button>
          <button
            className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
            onClick={() => {
              onDelete(node.id);
              onClose();
            }}
          >
            Delete
          </button>
        </>
      )}

      {node && importAddress && (
        <>
          <div className="border-t border-[#2a2d2e]" />
          <button
            className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
            onClick={() => {
              onCopyImport(importAddress);
              onClose();
            }}
          >
            Copy Import Address
          </button>
        </>
      )}

      <div className="border-t border-[#2a2d2e]" />
      <button
        className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
        onClick={() => {
          onExpandAll();
          onClose();
        }}
      >
        Expand All
      </button>
      <button
        className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
        onClick={() => {
          onCollapseAll();
          onClose();
        }}
      >
        Collapse All
      </button>
    </div>
  );
};

export default ExplorerContextMenu;
