import { useCallback, useMemo } from 'react';
import type { ExplorerNode } from '@/components/FileExplorer';
import type { SearchPattern, SearchResult } from '@/components/editor/types';
import { buildSearchResults, parseFilterRegex } from '@/components/editor/utils';

type Params = {
  treeData: ExplorerNode | null;
  fileContents: Record<string, string>;
  savedContents: Record<string, string>;
  searchIncludePattern: string;
  searchExcludePattern: string;
  searchQuery: string;
  searchPattern: SearchPattern;
  searchMatchCase: boolean;
};

export const useEditorSearchData = ({
  treeData,
  fileContents,
  savedContents,
  searchIncludePattern,
  searchExcludePattern,
  searchQuery,
  searchPattern,
  searchMatchCase,
}: Params) => {
  const nodeContentMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!treeData) return map;
    const walk = (node: ExplorerNode) => {
      if (node.type === 'file') {
        map.set(node.id, node.content ?? '');
      } else {
        node.children?.forEach(walk);
      }
    };
    walk(treeData);
    return map;
  }, [treeData]);

  const searchIncludeFilter = useMemo(
    () => parseFilterRegex(searchIncludePattern),
    [searchIncludePattern],
  );
  const searchExcludeFilter = useMemo(
    () => parseFilterRegex(searchExcludePattern),
    [searchExcludePattern],
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, ExplorerNode>();
    if (!treeData) return map;
    const walk = (node: ExplorerNode) => {
      map.set(node.id, node);
      node.children?.forEach(walk);
    };
    walk(treeData);
    return map;
  }, [treeData]);

  const searchFiles = useMemo(() => {
    if (!treeData) return [];
    const items: Array<{ id: string; name: string; content: string }> = [];
    const walk = (node: ExplorerNode) => {
      if (node.type === 'file') {
        if (searchIncludeFilter.regex && !searchIncludeFilter.regex.test(node.name)) {
          return;
        }
        if (searchExcludeFilter.regex && searchExcludeFilter.regex.test(node.name)) {
          return;
        }
        const content = fileContents[node.id] ?? savedContents[node.id] ?? node.content ?? '';
        items.push({ id: node.id, name: node.name, content });
      } else {
        node.children?.forEach(walk);
      }
    };
    walk(treeData);
    return items;
  }, [
    fileContents,
    savedContents,
    searchExcludeFilter.regex,
    searchIncludeFilter.regex,
    treeData,
  ]);

  const getNodeContent = useCallback(
    (id: string) => nodeContentMap.get(id) ?? '',
    [nodeContentMap],
  );

  const getPersistedContent = useCallback(
    (id: string) => (savedContents[id] !== undefined ? savedContents[id] : getNodeContent(id)),
    [getNodeContent, savedContents],
  );

  const searchResults: SearchResult[] = useMemo(
    () => buildSearchResults(searchQuery, searchFiles, searchPattern, searchMatchCase),
    [searchMatchCase, searchPattern, searchQuery, searchFiles],
  );

  return {
    nodeById,
    searchIncludeFilter,
    searchExcludeFilter,
    searchFiles,
    getPersistedContent,
    searchResults,
  };
};
