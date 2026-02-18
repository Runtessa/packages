import type React from "react";
import type { DropPosition, ExplorerNode, FlattenedNode } from "./types";

export const findNodeById = (
  node: ExplorerNode,
  id: string
): ExplorerNode | null => {
  if (node.id === id) return node;
  if (node.type === "folder") {
    for (const child of node.children ?? []) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
};

export const validateUniqueNameAmongSiblings = (
  siblings: ExplorerNode[] | undefined,
  name: string,
  excludeId?: string
) => {
  if (!siblings) return true;
  return !siblings.some(
    (sibling) =>
      sibling.name.toLowerCase() === name.toLowerCase() &&
      sibling.id !== excludeId
  );
};

export const removeNode = (
  node: ExplorerNode,
  id: string
): { tree: ExplorerNode; removed: ExplorerNode | null } => {
  if (node.id === id) {
    return { tree: node, removed: node };
  }

  if (node.type !== "folder" || !node.children) {
    return { tree: node, removed: null };
  }

  let removed: ExplorerNode | null = null;
  const children = node.children
    .map((child) => {
      const result = removeNode(child, id);
      if (result.removed) {
        removed = result.removed;
        return null;
      }
      return result.tree;
    })
    .filter(Boolean) as ExplorerNode[];

  return { tree: { ...node, children }, removed };
};

export const insertNode = (
  node: ExplorerNode,
  parentId: string,
  newNode: ExplorerNode,
  position?: number
): ExplorerNode => {
  if (node.id === parentId && node.type === "folder") {
    const children = node.children ? [...node.children] : [];
    const index =
      position === undefined
        ? children.length
        : Math.min(Math.max(position, 0), children.length);
    children.splice(index, 0, newNode);
    return { ...node, children };
  }

  if (node.type !== "folder" || !node.children) return node;

  return {
    ...node,
    children: node.children.map((child) =>
      insertNode(child, parentId, newNode, position)
    ),
  };
};

export const renameNode = (
  node: ExplorerNode,
  id: string,
  name: string
): ExplorerNode => {
  if (node.id === id) {
    return { ...node, name };
  }
  if (node.type !== "folder" || !node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => renameNode(child, id, name)),
  };
};

export const containsId = (node: ExplorerNode, searchId: string): boolean => {
  if (node.id === searchId) return true;
  if (node.type !== "folder" || !node.children) return false;
  return node.children.some((child) => containsId(child, searchId));
};

// Moves a node while preserving immutability and preventing invalid drops
export const moveNode = (
  tree: ExplorerNode,
  nodeId: string,
  targetId: string,
  position: DropPosition,
  parentMap: Map<string, string | null>
): ExplorerNode => {
  if (nodeId === targetId) return tree;
  const nodeToMove = findNodeById(tree, nodeId);
  if (!nodeToMove) return tree;

  // Prevent dropping a folder inside itself or a descendant
  if (nodeToMove.type === "folder" && containsId(nodeToMove, targetId)) {
    return tree;
  }

  const removedResult = removeNode(tree, nodeId);
  const detached = removedResult.removed;
  if (!detached) return tree;

  let workingTree = removedResult.tree;

  if (position === "inside") {
    const targetNode = findNodeById(workingTree, targetId);
    if (targetNode && targetNode.type === "folder") {
      return insertNode(workingTree, targetId, detached);
    }
    position = "after";
  }

  const parentId = parentMap.get(targetId);
  if (!parentId) return tree;

  const parentNode = findNodeById(workingTree, parentId);
  if (!parentNode || parentNode.type !== "folder") return tree;

  const siblings = parentNode.children ?? [];
  const targetIndex = siblings.findIndex((child) => child.id === targetId);
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;

  workingTree = insertNode(workingTree, parentId, detached, insertIndex);
  return workingTree;
};

export const buildParentMap = (node: ExplorerNode) => {
  const map = new Map<string, string | null>();
  const walk = (current: ExplorerNode, parentId: string | null) => {
    map.set(current.id, parentId);
    if (current.type === "folder") {
      current.children?.forEach((child) => walk(child, current.id));
    }
  };
  walk(node, null);
  return map;
};

export const flattenVisible = (
  node: ExplorerNode,
  expanded: Set<string>,
  depth = 0,
  acc: FlattenedNode[] = []
) => {
  acc.push({ node, depth });
  if (node.type === "folder" && expanded.has(node.id)) {
    node.children?.forEach((child) =>
      flattenVisible(child, expanded, depth + 1, acc)
    );
  }
  return acc;
};

export const collectFolderIds = (node: ExplorerNode, acc = new Set<string>()) => {
  if (node.type === "folder") {
    acc.add(node.id);
    node.children?.forEach((child) => collectFolderIds(child, acc));
  }
  return acc;
};

export const makeUniqueName = (
  siblings: ExplorerNode[] | undefined,
  desired: string
) => {
  if (!siblings || validateUniqueNameAmongSiblings(siblings, desired)) {
    return desired;
  }

  const match = desired.match(/^(.*?)(\.[^.]+)?$/);
  const base = match?.[1] ?? desired;
  const ext = match?.[2] ?? "";
  let index = 1;
  let candidate = `${base} ${index}${ext}`;
  while (!validateUniqueNameAmongSiblings(siblings, candidate)) {
    index += 1;
    candidate = `${base} ${index}${ext}`;
  }
  return candidate;
};

export const dropPositionFromPointer = (
  event: React.DragEvent,
  node: ExplorerNode,
  element: HTMLDivElement | null
): DropPosition => {
  if (!element) return "inside";
  const rect = element.getBoundingClientRect();
  const offsetY = event.clientY - rect.top;
  if (node.type === "folder") {
    if (!node.children || node.children.length === 0) return "inside";
    const threshold = Math.max(4, rect.height * 0.2);
    if (offsetY < threshold) return "before";
    if (offsetY > rect.height - threshold) return "after";
    return "inside";
  }
  return offsetY < rect.height / 2 ? "before" : "after";
};
