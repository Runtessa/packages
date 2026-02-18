import { useEffect, useState } from "react";
import { STORAGE_EXPANDED_KEY, STORAGE_TREE_KEY, initialData } from "./constants";
import type { ExplorerNode } from "./types";

const useExplorerStorage = (initialTree?: ExplorerNode) => {
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
    localStorage.setItem(STORAGE_EXPANDED_KEY, JSON.stringify(Array.from(expandedIds)));
  }, [expandedIds]);

  return {
    tree,
    setTree,
    expandedIds,
    setExpandedIds,
  };
};

export default useExplorerStorage;
