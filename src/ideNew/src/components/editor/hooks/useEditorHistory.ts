import { useCallback, useEffect, useRef, useState } from 'react';
import { HISTORY_PAGE_SIZE } from '@/components/editor/constants';
import type { HistoryResponse } from '@/components/editor/page-types';
import type {
  ActiveFile,
  HistoryItem,
  ModuleRevisionDto,
  UiRevisionDto,
} from '@/components/editor/types';

type FetchFn = (url: string, options?: { method?: string; body?: unknown }) => Promise<any>;

type Params = {
  activeFile: ActiveFile | null;
  apiFetch: FetchFn;
  leftPanel: string;
  leftPanelOpen: boolean;
};

export const useEditorHistory = ({
  activeFile,
  apiFetch,
  leftPanel,
  leftPanelOpen,
}: Params) => {
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historySelectedId, setHistorySelectedId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(HISTORY_PAGE_SIZE);
  const historyListRef = useRef<HTMLDivElement | null>(null);
  const historyRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHistorySelectedId(null);
    setHistoryPage(1);
  }, [activeFile?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const container = historyListRef.current;
    if (!container) return;
    const measure = () => {
      const height = container.getBoundingClientRect().height;
      if (height < 1) return;
      const rowHeight = 36;
      const nextSize = Math.max(1, Math.floor(height / rowHeight));
      setHistoryPageSize((prev) => (prev === nextSize ? prev : nextSize));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [leftPanel, leftPanelOpen]);

  const loadHistory = useCallback(
    async (page = historyPage) => {
      if (!activeFile?.meta) {
        setHistoryItems([]);
        setHistoryError('');
        setHistoryTotal(0);
        return;
      }
      if (
        activeFile.meta.kind === 'shared' ||
        activeFile.meta.kind === 'acl' ||
        activeFile.meta.kind === 'model'
      ) {
        setHistoryItems([]);
        setHistoryError('History is not available for this file.');
        setHistoryTotal(0);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      setHistoryError('');
      try {
        if (activeFile.meta.kind === 'module') {
          const response = (await apiFetch(
            `/api/modules/${activeFile.meta.backendId}/versions?page=${page}&limit=${historyPageSize}`,
          )) as HistoryResponse<ModuleRevisionDto> | ModuleRevisionDto[];
          if (Array.isArray(response)) {
            const total = response.length;
            const start = (page - 1) * historyPageSize;
            const items = response.slice(start, start + historyPageSize);
            setHistoryItems(items.map((rev) => ({ ...rev, kind: 'module' })));
            setHistoryTotal(total);
          } else {
            const items = response.items.slice(0, historyPageSize);
            setHistoryItems(items.map((rev) => ({ ...rev, kind: 'module' })));
            setHistoryTotal(response.total);
          }
        } else {
          const response = (await apiFetch(
            `/api/ui-entities/${activeFile.meta.backendId}/versions?page=${page}&limit=${historyPageSize}`,
          )) as HistoryResponse<UiRevisionDto> | UiRevisionDto[];
          if (Array.isArray(response)) {
            const total = response.length;
            const start = (page - 1) * historyPageSize;
            const items = response.slice(start, start + historyPageSize);
            setHistoryItems(items.map((rev) => ({ ...rev, kind: 'ui' })));
            setHistoryTotal(total);
          } else {
            const items = response.items.slice(0, historyPageSize);
            setHistoryItems(items.map((rev) => ({ ...rev, kind: 'ui' })));
            setHistoryTotal(response.total);
          }
        }
      } catch (err) {
        setHistoryError((err as Error).message || 'Failed to load history');
        setHistoryItems([]);
        setHistoryTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    },
    [activeFile?.meta, apiFetch, historyPage, historyPageSize],
  );

  useEffect(() => {
    if (!activeFile?.meta) {
      setHistoryItems([]);
      setHistoryError('');
      setHistoryTotal(0);
      return;
    }
    void loadHistory(historyPage);
  }, [activeFile?.meta, historyPage, loadHistory]);

  const historyTotalPages = Math.max(1, Math.ceil(historyTotal / historyPageSize));

  useEffect(() => {
    if (historyPage > historyTotalPages) {
      setHistoryPage(historyTotalPages);
    }
  }, [historyPage, historyTotalPages]);

  return {
    historyItems,
    historyLoading,
    historyError,
    historySelectedId,
    historyPage,
    historyTotalPages,
    historyListRef,
    historyRowRef,
    setHistorySelectedId,
    setHistoryPage,
    loadHistory,
  };
};
