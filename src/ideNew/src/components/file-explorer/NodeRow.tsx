import React, { useRef } from "react";
import { Chevron, FileTypeIcon, FolderIcon } from "./icons";
import type { NodeRowProps } from "./types";

const NodeRow = React.memo(function NodeRow({
  item,
  isSelected,
  isExpanded,
  isRenaming,
  dropState,
  renameValue,
  renameError,
  readOnly,
  onSelect,
  onToggleExpand,
  onContextMenu,
  onDragStart,
  onDragOverNode,
  onDragLeaveNode,
  onDropNode,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onOpenFile,
}: NodeRowProps) {
  const { node, depth } = item;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const isFolder = node.type === "folder";

  const dropLine =
    dropState === "before" || dropState === "after" ? (
      <div
        className={`absolute left-0 right-0 h-px bg-sky-400 ${
          dropState === "before" ? "top-0" : "bottom-0"
        }`}
      />
    ) : null;

  const dropInsideBadge =
    dropState === "inside" ? (
      <div className="absolute inset-0 rounded bg-sky-500/10 ring-1 ring-sky-400/60" />
    ) : null;

  return (
    <div
      ref={rowRef}
      className={`group relative flex cursor-default items-center gap-2 px-0.5 py-0.5 text-sm ${
        isSelected ? "bg-[#094771] text-white" : "text-gray-200 hover:bg-[#2a2d2e]"
      }`}
      style={{ paddingLeft: 4 + depth * 8 }}
      draggable={!isRenaming && !readOnly}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node, isRenaming);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (node.type === "folder") {
          onToggleExpand(node.id);
        } else {
          onOpenFile?.(node);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, node.id);
      }}
      onDragStart={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        onDragStart(node.id);
      }}
      onDragEnd={onDragLeaveNode}
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        onDragOverNode(node, e, rowRef.current);
      }}
      onDragLeave={onDragLeaveNode}
      onDrop={(e) => {
        if (readOnly) return;
        e.preventDefault();
        if (dropState) onDropNode(node.id, dropState);
      }}
    >
      {dropLine}
      {dropInsideBadge}
      <span className="flex items-center gap-1">
        {isFolder ? <Chevron open={isExpanded} /> : <span className="w-3.5" />}
      </span>
      <span className="flex items-center gap-2">
        {isFolder ? <FolderIcon open={isExpanded} /> : <FileTypeIcon name={node.name} />}
      </span>
      {isRenaming ? (
        <div className="flex flex-1 items-center gap-2">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => {
              onRenameChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRenameConfirm();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onRenameCancel();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-sm text-gray-100 focus:border-sky-500 focus:outline-none"
          />
          {renameError && <span className="text-xs text-red-400">{renameError}</span>}
        </div>
      ) : (
        <span className="flex-1 truncate">{node.name}</span>
      )}
    </div>
  );
});

export default NodeRow;
