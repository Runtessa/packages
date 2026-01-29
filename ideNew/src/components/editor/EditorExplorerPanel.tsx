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
    <FileExplorer
      key={treeData.id}
      onOpenFile={onOpenFile}
      initialTree={treeData}
      onCreateNode={onCreateNode}
      onRenameNode={onRenameNode}
      onDeleteNode={onDeleteNode}
      onMoveNode={onMoveNode}
    />
  );
}
