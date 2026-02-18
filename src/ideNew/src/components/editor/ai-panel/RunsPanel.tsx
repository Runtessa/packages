import { FiTrash2 } from 'react-icons/fi';
import type { AssistantRunSummary } from './shared';

type RunsPanelProps = {
  runs: AssistantRunSummary[];
  loadingRuns: boolean;
  showAllRuns: boolean;
  setShowAllRuns: (value: boolean | ((prev: boolean) => boolean)) => void;
  onRefresh: () => void;
  onInspectRun: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
};

export function RunsPanel({
  runs,
  loadingRuns,
  showAllRuns,
  setShowAllRuns,
  onRefresh,
  onInspectRun,
  onDeleteRun,
}: RunsPanelProps) {
  return (
    <div className="rounded-lg border border-[#2a2d2e] bg-[#171717] p-2.5 text-[11px] text-gray-300">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase text-gray-400">Recent runs</span>
        <button
          type="button"
          className="rounded border border-[#2a2d2e] px-2 py-0.5 text-[10px] text-gray-300 hover:bg-[#2a2d2e]"
          onClick={onRefresh}
        >
          {loadingRuns ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {runs.length ? (
        <div className="space-y-1">
          {(showAllRuns ? runs : runs.slice(0, 2)).map((run) => {
            const title = String(run.runName || '').trim();
            const displayTitle = title || `Run ${run.runId.slice(0, 8)}`;
            return (
              <div
                key={run.runId}
                className="flex items-center gap-1 rounded-md border border-transparent px-1 py-0.5 hover:border-[#2a2d2e] hover:bg-[#1f1f1f]"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-1 py-1 text-left"
                  onClick={() => onInspectRun(run.runId)}
                  title={title || run.runId}
                >
                  <span className="truncate text-[10px] text-gray-200">{displayTitle}</span>
                  <span className="text-[10px] text-gray-500">{run.status}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 items-center justify-center rounded border border-transparent text-gray-500 hover:border-[#2a2d2e] hover:bg-[#222] hover:text-gray-200"
                  onClick={() => onDeleteRun(run.runId)}
                  aria-label="Delete run"
                  title="Delete run"
                >
                  <FiTrash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {runs.length > 2 ? (
            <button
              type="button"
              className="w-full rounded border border-[#2a2d2e] px-2 py-1 text-[10px] text-gray-300 hover:bg-[#2a2d2e]"
              onClick={() => setShowAllRuns((prev) => !prev)}
            >
              {showAllRuns ? 'Show less' : `Show all (${runs.length})`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="text-[10px] text-gray-500">
          {loadingRuns ? 'Loading runs...' : 'No stored runs'}
        </div>
      )}
    </div>
  );
}
