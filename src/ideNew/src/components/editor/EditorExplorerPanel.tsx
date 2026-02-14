import FileExplorer, { ExplorerNode } from '@/components/FileExplorer';

type ExplorerPanelProps = {
  treeError: string;
  loadingTree: boolean;
  treeData: ExplorerNode | null;
  onReload: () => void;
  onOpenFile: (file: ExplorerNode) => void;
  onCreateNode: (args: { type: 'file' | 'folder'; parentPath: ExplorerNode[] }) => boolean | void;
  onRenameNode: (args: { node: ExplorerNode; parentPath: ExplorerNode[] }) => boolean | void;
  onDeleteNode: (args: { node: ExplorerNode; parentPath: ExplorerNode[] }) => boolean | void;
  onMoveNode: (args: {
    node: ExplorerNode;
    targetId: string;
    position: 'inside' | 'before' | 'after';
    parentPath: ExplorerNode[];
  }) => boolean | void;
  onMigrateModels?: () => void;
  migrateBusy?: boolean;
};

export function EditorExplorerPanel({
  treeError,
  loadingTree,
  treeData,
  onReload,
  onOpenFile,
  onCreateNode,
  onRenameNode,
  onDeleteNode,
  onMoveNode,
  onMigrateModels,
  migrateBusy,
}: ExplorerPanelProps) {
  if (treeError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-sm text-red-300">
        <p>{treeError}</p>
        <button
          className="rounded bg-[#094771] px-3 py-1 text-white hover:bg-[#0b5b96]"
          onClick={onReload}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!treeData || loadingTree) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Loading explorer...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div>Explorer</div>
        <div className="flex items-center gap-2">
          <button
            className="rounded px-2 py-1 text-[10px] font-semibold text-gray-200 hover:bg-[#2a2d2e]"
            onClick={onReload}
            type="button"
            aria-label="Refresh explorer"
            title="Refresh explorer"
          >
            Refresh
          </button>
          {onMigrateModels && (
            <button
              className="rounded px-2 py-1 text-[10px] font-semibold text-gray-200 hover:bg-[#2a2d2e] disabled:opacity-60"
              onClick={onMigrateModels}
              type="button"
              disabled={migrateBusy}
              title="Apply ORM models to database"
            >
              {migrateBusy ? 'Migrating…' : 'Migrate'}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <FileExplorer
          key={treeData.id}
          onOpenFile={onOpenFile}
          initialTree={treeData}
          onCreateNode={onCreateNode}
          onRenameNode={onRenameNode}
          onDeleteNode={onDeleteNode}
          onMoveNode={onMoveNode}
        />
      </div>
    </div>
  );
}
