import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "@/components/ui/Toast";
import {
  MdCode,
  MdDataObject,
  MdDescription,
  MdFolder,
  MdFolderOpen,
  MdHtml,
  MdInsertDriveFile,
  MdStorage,
  MdTerminal,
} from "react-icons/md";

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

type DropPosition = "inside" | "before" | "after";

type FlattenedNode = {
  node: ExplorerNode;
  depth: number;
};

type DropIndicator = {
  id: string;
  position: DropPosition;
};

type ContextMenuState = {
  x: number;
  y: number;
  nodeId: string | null;
};

type NodeRowProps = {
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

const STORAGE_TREE_KEY = "vscode-file-explorer-tree";
const STORAGE_EXPANDED_KEY = "vscode-file-explorer-expanded";

const initialData: ExplorerNode = {
  id: "root",
  name: "PROJECT",
  type: "folder",
  children: [
    {
      id: "src-folder",
      name: "src",
      type: "folder",
      children: [
        {
          id: "components-folder",
          name: "components",
          type: "folder",
          children: [
            { id: "button-file", name: "Button.jsx", type: "file" },
            { id: "card-file", name: "Card.jsx", type: "file" },
            {
              id: "hooks-folder",
              name: "hooks",
              type: "folder",
              children: [
                { id: "useAuth-file", name: "useAuth.js", type: "file" },
                { id: "useTheme-file", name: "useTheme.js", type: "file" },
              ],
            },
          ],
        },
        { id: "app-file", name: "App.jsx", type: "file" },
        { id: "main-file", name: "main.jsx", type: "file" },
        { id: "styles-file", name: "global.css", type: "file" },
      ],
    },
    {
      id: "config-folder",
      name: "config",
      type: "folder",
      children: [
        { id: "tsconfig-file", name: "tsconfig.json", type: "file" },
        { id: "package-file", name: "package.json", type: "file" },
      ],
    },
    {
      id: "public-folder",
      name: "public",
      type: "folder",
      children: [
        { id: "index-html-file", name: "index.html", type: "file" },
        { id: "favicon-file", name: "favicon.ico", type: "file" },
      ],
    },
    { id: "readme-file", name: "README.md", type: "file" },
  ],
};

const makeId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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

const containsId = (node: ExplorerNode, searchId: string): boolean => {
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

const buildParentMap = (node: ExplorerNode) => {
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

const flattenVisible = (
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

const collectFolderIds = (node: ExplorerNode, acc = new Set<string>()) => {
  if (node.type === "folder") {
    acc.add(node.id);
    node.children?.forEach((child) => collectFolderIds(child, acc));
  }
  return acc;
};

const makeUniqueName = (
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

const dropPositionFromPointer = (
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

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    className="h-3.5 w-3.5 text-gray-400"
    viewBox="0 0 12 12"
    aria-hidden
  >
    <path
      d={open ? "M2 9l4-6 4 6z" : "M3 2l6 4-6 4z"}
      fill="currentColor"
    />
  </svg>
);

const FolderIcon = ({ open }: { open: boolean }) =>
  open ? (
    <MdFolderOpen className="h-4 w-4 text-yellow-400" aria-hidden />
  ) : (
    <MdFolder className="h-4 w-4 text-yellow-400" aria-hidden />
  );

const FILE_ICON_BY_EXT: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  js: { icon: MdCode, color: "text-yellow-300" },
  jsx: { icon: MdCode, color: "text-yellow-300" },
  ts: { icon: MdCode, color: "text-blue-300" },
  tsx: { icon: MdCode, color: "text-blue-300" },
  json: { icon: MdDataObject, color: "text-emerald-300" },
  md: { icon: MdDescription, color: "text-slate-300" },
  html: { icon: MdHtml, color: "text-orange-300" },
  css: { icon: MdDescription, color: "text-violet-300" },
  scss: { icon: MdDescription, color: "text-pink-300" },
  env: { icon: MdTerminal, color: "text-lime-300" },
  sql: { icon: MdStorage, color: "text-teal-300" },
  yml: { icon: MdDescription, color: "text-amber-300" },
  yaml: { icon: MdDescription, color: "text-amber-300" },
};

const FILE_ICON_BY_NAME: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  dockerfile: { icon: MdTerminal, color: "text-sky-300" },
  makefile: { icon: MdTerminal, color: "text-amber-300" },
};

const FileTypeIcon = ({ name }: { name?: string }) => {
  const lower = (name ?? "").toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  const def = FILE_ICON_BY_NAME[lower] || FILE_ICON_BY_EXT[ext];
  const Icon = def?.icon ?? MdInsertDriveFile;
  const color = def?.color ?? (lower.startsWith(".env") ? "text-lime-300" : "text-blue-300");
  return <Icon className={`h-4 w-4 ${color}`} aria-hidden />;
};

const NewFileIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 2v5h5l-5-5z"
    />
    <path
      fill="currentColor"
      d="M11 12h2v3h3v2h-3v3h-2v-3H8v-2h3v-3z"
    />
  </svg>
);

const NewFolderIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M3 6h6l2 2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3z"
    />
    <path
      fill="currentColor"
      d="M11 12h2v3h3v2h-3v3h-2v-3H8v-2h3v-3z"
    />
  </svg>
);

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
        {isFolder ? (
          <Chevron open={isExpanded} />
        ) : (
          <span className="w-3.5" />
        )}
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
          {renameError && (
            <span className="text-xs text-red-400">{renameError}</span>
          )}
        </div>
      ) : (
        <span className="flex-1 truncate">{node.name}</span>
      )}
    </div>
  );
});

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
  const [tree, setTree] = useState<ExplorerNode>(() => {
    if (typeof window === "undefined") return initialData;
    if (initialTree) return initialTree;
    const stored = localStorage.getItem(STORAGE_TREE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as ExplorerNode;
      } catch {
        return initialData;
      }
    }
    return initialData;
  });

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(["root"]);
    const stored = localStorage.getItem(STORAGE_EXPANDED_KEY);
    if (stored) {
      try {
        return new Set(JSON.parse(stored) as string[]);
      } catch {
        return new Set(["root"]);
      }
    }
    return new Set(["root"]);
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const copyToClipboard = useCallback(
    async (value: string) => {
      if (!value) return;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          success("Import address copied");
          return;
        }
      } catch {
        // fallback below
      }
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (ok) {
          success("Import address copied");
        } else {
          error("Failed to copy import address");
        }
      } catch {
        error("Failed to copy import address");
      }
    },
    [error, success]
  );

  const resolveImportAddress = useCallback(
    (node: ExplorerNode) => {
      const meta = (node.meta ?? {}) as Record<string, unknown>;
      if (meta.kind === "ui" && typeof meta.name === "string") {
        return meta.name;
      }
      if (meta.kind === "shared") {
        const projectName = typeof tree.name === "string" ? tree.name : "";
        return projectName && projectName !== "PROJECT" ? projectName : null;
      }
      return null;
    },
    [tree.name]
  );

  useEffect(() => {
    if (initialTree) {
      setTree(initialTree);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(initialTree.id);
        return next;
      });
    }
  }, [initialTree]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_TREE_KEY, JSON.stringify(tree));
  }, [tree]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      STORAGE_EXPANDED_KEY,
      JSON.stringify(Array.from(expandedIds))
    );
  }, [expandedIds]);

  useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const parentMap = useMemo(() => buildParentMap(tree), [tree]);
  const visibleNodes = useMemo(
    () => flattenVisible(tree, expandedIds),
    [tree, expandedIds]
  );

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
    },
    [getParentPath, onRenameNode, parentMap, readOnly, tree]
  );

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameError(null);
    setRenameValue("");
  }, []);

  const confirmRename = useCallback(() => {
    if (readOnly) return;
    if (!renamingId) return;
    // Inline rename validation: non-empty and unique among siblings
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
    const siblings =
      parent && parent.type === "folder" ? parent.children ?? [] : [];

    if (!validateUniqueNameAmongSiblings(siblings, trimmed, renamingId)) {
      setRenameError("Name must be unique in this folder");
      return;
    }

    setTree((prev) => renameNode(prev, renamingId, trimmed));
    setRenamingId(null);
    setRenameError(null);
  }, [parentMap, readOnly, renamingId, renameValue, tree]);

  const resolveParentForCreate = useCallback(() => {
    if (!selectedId) return "root";
    const selected = findNodeById(tree, selectedId);
    if (!selected) return "root";
    if (selected.type === "folder") return selected.id;
    const parentId = parentMap.get(selected.id);
    return parentId ?? "root";
  }, [parentMap, selectedId, tree]);

  const createNode = useCallback(
    (type: "file" | "folder") => {
      if (readOnly) return;
      const parentId = resolveParentForCreate();
      const parent = findNodeById(tree, parentId);
      if (!parent || parent.type !== "folder") return;
      const parentPath = getParentPath(parentId);
      const handled = onCreateNode?.({ type, parentId, parentPath });
      if (handled) return;

      // Pick a unique, contextual default name for the new entry
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
    },
    [getParentPath, onCreateNode, readOnly, resolveParentForCreate, tree]
  );

  const handleDelete = useCallback(
    (id: string | null) => {
      if (readOnly) return;
      if (!id || id === "root") return;
      const node = findNodeById(tree, id);
      if (!node) return;
      const parentId = parentMap.get(node.id) ?? null;
      const parentPath = getParentPath(parentId);
      const handled = onDeleteNode?.({ node, parentId, parentPath });
      if (handled) return;
      const result = removeNode(tree, id);
      if (result.removed) {
        setTree(result.tree);
        if (selectedId === id) setSelectedId(null);
        if (renamingId === id) cancelRename();
        success(
          `Deleted "${node.name}"${
            node.type === "folder" ? " and its contents" : ""
          }`
        );
      }
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
    ]
  );

  const performDrop = useCallback(
    (targetId: string, position: DropPosition) => {
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
      // Apply move and expand destination folders when dropping inside
      setTree((prev) =>
        moveNode(prev, draggingId, targetId, position, buildParentMap(prev))
      );
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (position === "inside") next.add(targetId);
        return next;
      });
      setDraggingId(null);
      setDropIndicator(null);
    },
    [draggingId, getParentPath, onMoveNode, parentMap, readOnly, tree]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (contextMenu) setContextMenu(null);

      const currentIndex = visibleNodes.findIndex(
        (item) => item.node.id === selectedId
      );
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

  const onContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string | null) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        nodeId,
      });
      if (nodeId) setSelectedId(nodeId);
    },
    []
  );

  const handleSelectNode = useCallback(
    (node: ExplorerNode, isRenaming: boolean) => {
      setSelectedId(node.id);
      setContextMenu(null);
      if (node.type === "file" && !isRenaming) {
        onOpenFile?.(node);
      }
    },
    [onOpenFile]
  );

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
    setDropIndicator(null);
  }, []);

  const handleDragOverNode = useCallback(
    (
      node: ExplorerNode,
      e: React.DragEvent<HTMLDivElement>,
      ref: HTMLDivElement | null
    ) => {
      if (!draggingId || draggingId === node.id) return;
      const position = dropPositionFromPointer(e, node, ref);
      const draggingNode = draggingId ? findNodeById(tree, draggingId) : null;
      if (
        draggingNode &&
        draggingNode.type === "folder" &&
        containsId(draggingNode, node.id)
      ) {
        setDropIndicator(null);
        return;
      }
      setDropIndicator({ id: node.id, position });
    },
    [draggingId, tree]
  );

  const handleDragLeaveNode = useCallback(() => setDropIndicator(null), []);

  const handleDropNode = useCallback(
    (targetId: string, position: DropPosition) => {
      setDropIndicator(null);
      performDrop(targetId, position);
    },
    [performDrop]
  );

  const handleRenameChange = useCallback((value: string) => {
    setRenameValue(value);
    setRenameError(null);
  }, []);

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const node = contextMenu.nodeId ? findNodeById(tree, contextMenu.nodeId) : null;
    const isRoot = node?.id === "root";
    const importAddress = node ? resolveImportAddress(node) : null;

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
                createNode("file");
                setContextMenu(null);
              }}
            >
              New File
            </button>
            <button
              className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
              onClick={() => {
                createNode("folder");
                setContextMenu(null);
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
                startRename(node.id);
                setContextMenu(null);
              }}
            >
              Rename
            </button>
            <button
              className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
              onClick={() => {
                handleDelete(node.id);
                setContextMenu(null);
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
                void copyToClipboard(importAddress);
                setContextMenu(null);
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
            const allIds = new Set<string>();
            collectFolderIds(tree, allIds);
            setExpandedIds(allIds);
            setContextMenu(null);
          }}
        >
          Expand All
        </button>
        <button
          className="flex w-full items-center px-3 py-2 text-left hover:bg-[#2e2e2e]"
          onClick={() => {
            setExpandedIds(new Set(["root"]));
            setContextMenu(null);
          }}
        >
          Collapse All
        </button>
      </div>
    );
  };

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
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <span>Project</span>
        {!readOnly && (
          <div className="flex items-center gap-1 text-gray-400">
            <button
              type="button"
              className="rounded p-1 hover:bg-[#2a2d2e] hover:text-gray-200"
              onClick={(e) => {
                e.stopPropagation();
                createNode("file");
              }}
              aria-label="New file"
              title="New file"
            >
              <NewFileIcon />
            </button>
            <button
              type="button"
              className="rounded p-1 hover:bg-[#2a2d2e] hover:text-gray-200"
              onClick={(e) => {
                e.stopPropagation();
                createNode("folder");
              }}
              aria-label="New folder"
              title="New folder"
            >
              <NewFolderIcon />
            </button>
          </div>
        )}
      </div>

      <div
        className="flex-1 overflow-auto"
        onClick={(e) => {
          e.stopPropagation();
          clearSelection();
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
                dropIndicator && dropIndicator.id === item.node.id
                  ? dropIndicator.position
                  : null
              }
              readOnly={readOnly}
              renameValue={renamingId === item.node.id ? renameValue : ""}
              renameError={renamingId === item.node.id ? renameError : null}
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
          )
        )}
      </div>

      {renderContextMenu()}
    </div>
  );
}
