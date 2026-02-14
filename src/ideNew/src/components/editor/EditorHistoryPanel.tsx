import { FiChevronLeft, FiChevronRight, FiEye, FiEyeOff, FiRefreshCw, FiRotateCcw } from 'react-icons/fi';
import type { RefObject } from 'react';
import type { ActiveFile, HistoryItem } from '@/components/editor/types';

type EditorHistoryPanelProps = {
  activeFile: ActiveFile | null;
  historyItems: HistoryItem[];
  historySelectedId: string | null;
  historyLoading: boolean;
  historyError: string;
  historyPage: number;
  historyTotalPages: number;
  historyListRef: RefObject<HTMLDivElement | null>;
  historyRowRef: RefObject<HTMLDivElement | null>;
  onRefresh: (page?: number) => void;
  onSelectRevision: (id: string | null) => void;
  onRollback: (id: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  formatTimestamp: (value: string) => string;
};

export function EditorHistoryPanel({
  activeFile,
  historyItems,
  historySelectedId,
  historyLoading,
  historyError,
  historyPage,
  historyTotalPages,
  historyListRef,
  historyRowRef,
  onRefresh,
  onSelectRevision,
  onRollback,
  onPrevPage,
  onNextPage,
  formatTimestamp,
}: EditorHistoryPanelProps) {
  const disableRefresh =
    historyLoading ||
    !activeFile?.meta ||
    activeFile.meta.kind === 'shared' ||
    activeFile.meta.kind === 'acl' ||
    activeFile.meta.kind === 'model';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div>History</div>
        <button
          className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200 disabled:opacity-60"
          onClick={() => onRefresh(historyPage)}
          disabled={disableRefresh}
          aria-label="Refresh history"
          title="Refresh history"
          type="button"
        >
          <FiRefreshCw className="h-4 w-4" />
        </button>
      </div>

      {!activeFile?.meta ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          Select a file to view history.
        </div>
      ) : activeFile.meta.kind === 'shared' ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          History is not available for shared projects yet.
        </div>
      ) : activeFile.meta.kind === 'acl' ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          History is not available for ACL files.
        </div>
      ) : activeFile.meta.kind === 'model' ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          History is not available for models yet.
        </div>
      ) : historyLoading ? (
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-gray-400">
          Loading history...
        </div>
      ) : historyError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-sm text-red-300">
          <p>{historyError}</p>
          <button
            className="rounded bg-[#094771] px-3 py-1 text-white hover:bg-[#0b5b96]"
            onClick={() => onRefresh(historyPage)}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div ref={historyListRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {historyItems.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-sm text-gray-400">
                No revisions yet.
              </div>
            ) : (
              historyItems.map((item, index) => {
                const selected = item.id === historySelectedId;
                return (
                  <div
                    key={item.id}
                    ref={index === 0 ? historyRowRef : undefined}
                    className={`border-b border-[#2a2d2e] px-2 py-1.5 text-[11px] ${
                      selected ? 'bg-[#1f1f1f]' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-gray-100">
                          <span>r{item.revision}</span>
                          <span className="text-[9px] uppercase tracking-wide text-gray-500">
                            {(item.action ?? 'update').toUpperCase()}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[9px] text-gray-500">
                          {formatTimestamp(item.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200"
                          onClick={() => onSelectRevision(selected ? null : item.id)}
                          aria-label={selected ? 'Close compare' : 'Compare revision'}
                          title={selected ? 'Close compare' : 'Compare revision'}
                        >
                          {selected ? <FiEyeOff className="h-4 w-4" /> : <FiEye className="h-4 w-4" />}
                        </button>
                        <button
                          className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200"
                          onClick={() => onRollback(item.id)}
                          aria-label="Rollback revision"
                          title="Rollback revision"
                        >
                          <FiRotateCcw className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex h-7 items-center justify-between border-t border-[#2a2d2e] px-2 text-[10px] text-gray-400">
            <button
              className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200 disabled:opacity-50"
              onClick={onPrevPage}
              disabled={historyLoading || historyPage <= 1}
              aria-label="Previous page"
              title="Previous page"
            >
              <FiChevronLeft className="h-4 w-4" />
            </button>
            <div>
              Page {historyPage} / {historyTotalPages}
            </div>
            <button
              className="rounded p-1 text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200 disabled:opacity-50"
              onClick={onNextPage}
              disabled={historyLoading || historyPage >= historyTotalPages}
              aria-label="Next page"
              title="Next page"
            >
              <FiChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
