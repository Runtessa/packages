import type React from "react";

export type ExplorerNode = {
  id: string;
  name: string;
  type: "folder" | "file";
  children?: ExplorerNode[];
  // Optional metadata passed through to the consumer (e.g., backend identifiers)
  meta?: Record<string, unknown>;
  // Optional initial content for the node (used by the consumer)
  content?: string;
};

export type DropPosition = "inside" | "before" | "after";

export type FileExplorerProps = {
  onOpenFile?: (file: ExplorerNode) => void;
  initialTree?: ExplorerNode;
  readOnly?: boolean;
  onCreateNode?: (context: {
    type: "file" | "folder";
    parentId: string;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  onRenameNode?: (context: {
    node: ExplorerNode;
    parentId: string | null;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  onDeleteNode?: (context: {
    node: ExplorerNode;
    parentId: string | null;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  onMoveNode?: (context: {
    node: ExplorerNode;
    targetId: string;
    position: DropPosition;
    parentId: string | null;
    parentPath: ExplorerNode[];
  }) => boolean | void;
};

export type FlattenedNode = {
  node: ExplorerNode;
  depth: number;
};

export type DropIndicator = {
  id: string;
  position: DropPosition;
};

export type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string | null;
};

export type NodeRowProps = {
  item: FlattenedNode;
  isSelected: boolean;
  isExpanded: boolean;
  isRenaming: boolean;
  dropState: DropPosition | null;
  renameValue: string;
  renameError: string | null;
  readOnly: boolean;
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
