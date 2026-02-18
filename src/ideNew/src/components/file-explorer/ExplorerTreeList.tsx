import React from "react";
import NodeRow from "./NodeRow";
import type { DropIndicator, DropPosition, ExplorerNode, FlattenedNode } from "./types";

type ExplorerTreeListProps = {
  visibleNodes: FlattenedNode[];
  selectedId: string | null;
  expandedIds: Set<string>;
  renamingId: string | null;
  dropIndicator: DropIndicator | null;
  readOnly: boolean;
  renameValue: string;
  renameError: string | null;
  onClearSelection: () => void;
  onSelect: (node: ExplorerNode, isRenaming: boolean) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
  onDragStart: (id: string) => void;
  onDragOverNode: (
    node: ExplorerNode,
    e: React.DragEvent<HTMLDivElement>,
    ref: HTMLDivElement | null
  ) => void;
  onDragLeaveNode: () => void;
  onDropNode: (targetId: string, position: DropPosition) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onOpenFile?: (file: ExplorerNode) => void;
};

const ExplorerTreeList = ({
  visibleNodes,
  selectedId,
  expandedIds,
  renamingId,
  dropIndicator,
  readOnly,
  renameValue,
  renameError,
  onClearSelection,
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
}: ExplorerTreeListProps) => {
  return (
    <div
      className="flex-1 overflow-auto"
      onClick={(e) => {
        e.stopPropagation();
        onClearSelection();
      }}
    >
      {visibleNodes.map((item) =>
        item.node.id === "root" ? null : (
          <NodeRow
            key={item.node.id}
            item={item}
            isSelected={selectedId === item.node.id}
            isExpanded={expandedIds.has(item.node.id)}
            isRenaming={renamingId === item.node.id}
            dropState={
              dropIndicator && dropIndicator.id === item.node.id ? dropIndicator.position : null
            }
            readOnly={readOnly}
            renameValue={renamingId === item.node.id ? renameValue : ""}
            renameError={renamingId === item.node.id ? renameError : null}
            onSelect={onSelect}
            onToggleExpand={onToggleExpand}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragOverNode={onDragOverNode}
            onDragLeaveNode={onDragLeaveNode}
            onDropNode={onDropNode}
            onRenameChange={onRenameChange}
            onRenameConfirm={onRenameConfirm}
            onRenameCancel={onRenameCancel}
            onOpenFile={onOpenFile}
          />
        )
      )}
    </div>
  );
};

export default ExplorerTreeList;
