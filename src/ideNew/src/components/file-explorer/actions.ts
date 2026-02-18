import type { Dispatch, SetStateAction } from "react";
import { makeId } from "./constants";
import {
  buildParentMap,
  findNodeById,
  insertNode,
  makeUniqueName,
  moveNode,
  removeNode,
  renameNode,
  validateUniqueNameAmongSiblings,
} from "./tree-utils";
import type { DropPosition, ExplorerNode } from "./types";

type ParentPathResolver = (nodeId: string | null) => ExplorerNode[];

export const startRenameAction = ({
  id,
  readOnly,
  tree,
  parentMap,
  getParentPath,
  onRenameNode,
  setRenamingId,
  setRenameValue,
  setRenameError,
}: {
  id: string;
  readOnly: boolean;
  tree: ExplorerNode;
  parentMap: Map<string, string | null>;
  getParentPath: ParentPathResolver;
  onRenameNode?: (context: {
    node: ExplorerNode;
    parentId: string | null;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenameError: Dispatch<SetStateAction<string | null>>;
}) => {
  if (readOnly) return;
  const node = findNodeById(tree, id);
  if (!node || node.id === "root") return;
  const parentId = parentMap.get(node.id) ?? null;
  const parentPath = getParentPath(parentId);
  const handled = onRenameNode?.({ node, parentId, parentPath });
  if (handled) return;
  setRenamingId(id);
  setRenameValue(node.name);
  setRenameError(null);
};

export const confirmRenameAction = ({
  readOnly,
  renamingId,
  renameValue,
  parentMap,
  tree,
  setRenameError,
  setTree,
  setRenamingId,
}: {
  readOnly: boolean;
  renamingId: string | null;
  renameValue: string;
  parentMap: Map<string, string | null>;
  tree: ExplorerNode;
  setRenameError: Dispatch<SetStateAction<string | null>>;
  setTree: Dispatch<SetStateAction<ExplorerNode>>;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
}) => {
  if (readOnly) return;
  if (!renamingId) return;

  const trimmed = renameValue.trim();
  if (!trimmed) {
    setRenameError("Name cannot be empty");
    return;
  }

  const parentId = parentMap.get(renamingId);
  const parent =
    parentId && parentId !== "root"
      ? findNodeById(tree, parentId)
      : findNodeById(tree, "root");
  const siblings = parent && parent.type === "folder" ? parent.children ?? [] : [];

  if (!validateUniqueNameAmongSiblings(siblings, trimmed, renamingId)) {
    setRenameError("Name must be unique in this folder");
    return;
  }

  setTree((prev) => renameNode(prev, renamingId, trimmed));
  setRenamingId(null);
  setRenameError(null);
};

export const createNodeAction = ({
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
}: {
  type: "file" | "folder";
  readOnly: boolean;
  tree: ExplorerNode;
  selectedId: string | null;
  parentMap: Map<string, string | null>;
  getParentPath: ParentPathResolver;
  onCreateNode?: (context: {
    type: "file" | "folder";
    parentId: string;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  setTree: Dispatch<SetStateAction<ExplorerNode>>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setRenamingId: Dispatch<SetStateAction<string | null>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  setRenameError: Dispatch<SetStateAction<string | null>>;
}) => {
  if (readOnly) return;
  const resolveParentForCreate = () => {
    if (!selectedId) return "root";
    const selected = findNodeById(tree, selectedId);
    if (!selected) return "root";
    if (selected.type === "folder") return selected.id;
    const parentId = parentMap.get(selected.id);
    return parentId ?? "root";
  };

  const parentId = resolveParentForCreate();
  const parent = findNodeById(tree, parentId);
  if (!parent || parent.type !== "folder") return;
  const parentPath = getParentPath(parentId);
  const handled = onCreateNode?.({ type, parentId, parentPath });
  if (handled) return;

  const baseName = type === "file" ? "New File" : "New Folder";
  const siblings = parent.children ?? [];
  const name = makeUniqueName(siblings, baseName);

  const newNode: ExplorerNode = {
    id: makeId(),
    name,
    type,
    children: type === "folder" ? [] : undefined,
  };

  setTree((prev) => insertNode(prev, parentId, newNode));
  setExpandedIds((prev) => {
    const next = new Set(prev);
    next.add(parentId);
    if (type === "folder") next.add(newNode.id);
    return next;
  });
  setSelectedId(newNode.id);
  setRenamingId(newNode.id);
  setRenameValue(name);
  setRenameError(null);
};

export const deleteNodeAction = ({
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
}: {
  id: string | null;
  readOnly: boolean;
  tree: ExplorerNode;
  parentMap: Map<string, string | null>;
  getParentPath: ParentPathResolver;
  selectedId: string | null;
  renamingId: string | null;
  onDeleteNode?: (context: {
    node: ExplorerNode;
    parentId: string | null;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  setTree: Dispatch<SetStateAction<ExplorerNode>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  cancelRename: () => void;
  success: (message: string) => void;
}) => {
  if (readOnly) return;
  if (!id || id === "root") return;
  const node = findNodeById(tree, id);
  if (!node) return;
  const parentId = parentMap.get(node.id) ?? null;
  const parentPath = getParentPath(parentId);
  const handled = onDeleteNode?.({ node, parentId, parentPath });
  if (handled) return;
  const result = removeNode(tree, id);
  if (!result.removed) return;
  setTree(result.tree);
  if (selectedId === id) setSelectedId(null);
  if (renamingId === id) cancelRename();
  success(`Deleted "${node.name}"${node.type === "folder" ? " and its contents" : ""}`);
};

export const performDropAction = ({
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
}: {
  targetId: string;
  position: DropPosition;
  readOnly: boolean;
  draggingId: string | null;
  tree: ExplorerNode;
  parentMap: Map<string, string | null>;
  getParentPath: ParentPathResolver;
  onMoveNode?: (context: {
    node: ExplorerNode;
    targetId: string;
    position: DropPosition;
    parentId: string | null;
    parentPath: ExplorerNode[];
  }) => boolean | void;
  setDraggingId: Dispatch<SetStateAction<string | null>>;
  setDropIndicator: Dispatch<
    SetStateAction<{ id: string; position: DropPosition } | null>
  >;
  setTree: Dispatch<SetStateAction<ExplorerNode>>;
  setExpandedIds: Dispatch<SetStateAction<Set<string>>>;
}) => {
  if (readOnly) return;
  if (!draggingId) return;
  const movingNode = findNodeById(tree, draggingId);
  if (movingNode) {
    const parentId = parentMap.get(movingNode.id) ?? null;
    const parentPath = getParentPath(parentId);
    const handled = onMoveNode?.({
      node: movingNode,
      targetId,
      position,
      parentId,
      parentPath,
    });
    if (handled) {
      setDraggingId(null);
      setDropIndicator(null);
      return;
    }
  }

  setTree((prev) => moveNode(prev, draggingId, targetId, position, buildParentMap(prev)));
  setExpandedIds((prev) => {
    const next = new Set(prev);
    if (position === "inside") next.add(targetId);
    return next;
  });
  setDraggingId(null);
  setDropIndicator(null);
};
