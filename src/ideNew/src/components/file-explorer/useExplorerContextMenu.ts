import { useCallback, useMemo } from "react";
import { collectFolderIds, findNodeById } from "./tree-utils";
import type { ContextMenuState, ExplorerNode } from "./types";

type UseExplorerContextMenuParams = {
  contextMenu: ContextMenuState | null;
  tree: ExplorerNode;
  setExpandedIds: (value: Set<string>) => void;
  resolveImportAddress: (node: ExplorerNode) => string | null;
};

const useExplorerContextMenu = ({
  contextMenu,
  tree,
  setExpandedIds,
  resolveImportAddress,
}: UseExplorerContextMenuParams) => {
  const contextMenuNode = useMemo(
    () => (contextMenu?.nodeId ? findNodeById(tree, contextMenu.nodeId) : null),
    [contextMenu?.nodeId, tree]
  );

  const contextMenuImportAddress = useMemo(
    () => (contextMenuNode ? resolveImportAddress(contextMenuNode) : null),
    [contextMenuNode, resolveImportAddress]
  );

  const expandAll = useCallback(() => {
    const allIds = new Set<string>();
    collectFolderIds(tree, allIds);
    setExpandedIds(allIds);
  }, [setExpandedIds, tree]);

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set(["root"]));
  }, [setExpandedIds]);

  return {
    contextMenuNode,
    contextMenuImportAddress,
    expandAll,
    collapseAll,
  };
};

export default useExplorerContextMenu;
