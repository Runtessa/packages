import type { StagingItem } from '@/components/editor/types';

type EditorStagingPanelProps = {
  stagingItems: StagingItem[];
  stagingCounts: { total: number; published: number };
  stagingPublishableCount: number;
  stagingBusy: boolean;
  stagingBusyId: string | null;
  onPublish: (item: StagingItem) => void;
  onPublishAll: () => void;
  formatTimestamp: (value: string) => string;
};

export function EditorStagingPanel({
  stagingItems,
  stagingCounts,
  stagingPublishableCount,
  stagingBusy,
  stagingBusyId,
  onPublish,
  onPublishAll,
  formatTimestamp,
}: EditorStagingPanelProps) {
  const publishAllBusy = stagingBusy && stagingBusyId === '__all__';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div>Staging</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-[#0b5b96] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#0f72be] disabled:opacity-60"
            onClick={onPublishAll}
            disabled={stagingBusy || stagingPublishableCount === 0}
          >
            {publishAllBusy
              ? 'Publishing…'
              : `Publish all${stagingPublishableCount > 0 ? ` (${stagingPublishableCount})` : ''}`}
          </button>
          <div className="text-[10px] text-gray-500">
            {stagingCounts.published}/{stagingCounts.total} published
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto p-2 text-[11px] text-gray-300">
        {stagingItems.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            No files available for staging.
          </div>
        ) : (
          stagingItems.map((item) => {
            const isPublished = Boolean(item.publishedVersion);
            const isDirty = Boolean(item.dirty);
            const isPublishing = stagingBusy && stagingBusyId === item.id;
            const kindLabel =
              item.kind === 'module' ? 'Module' : item.kind === 'ui' ? 'UI' : 'Shared';
            return (
              <div
                key={item.id}
                className="rounded border border-[#2a2d2e] bg-[#1f1f1f] p-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-semibold text-gray-100">
                        {item.title}
                      </span>
                      <span className="rounded border border-[#2a2d2e] px-1.5 py-0.5 text-[9px] uppercase text-gray-400">
                        {kindLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      <span className="mr-2">Draft: {item.draftVersion || '—'}</span>
                      <span>Published: {item.publishedVersion || '—'}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isDirty && (
                      <span className="rounded bg-[#3b1f1f] px-1.5 py-0.5 text-[9px] text-red-200">
                        Unsaved
                      </span>
                    )}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] ${
                        isPublished
                          ? 'bg-emerald-900/40 text-emerald-300'
                          : 'bg-[#2a2d2e] text-gray-400'
                      }`}
                    >
                      {isPublished ? 'Published' : 'Draft'}
                    </span>
                    <button
                      type="button"
                      className="rounded bg-[#0b5b96] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#0f72be] disabled:opacity-60"
                      onClick={() => onPublish(item)}
                      disabled={stagingBusy || isDirty}
                    >
                      {isPublishing ? 'Publishing…' : isPublished ? 'Republish' : 'Publish'}
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[9px] text-gray-500">
                  {item.publishedAt
                    ? `Published ${formatTimestamp(item.publishedAt)}`
                    : 'Not published yet'}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
