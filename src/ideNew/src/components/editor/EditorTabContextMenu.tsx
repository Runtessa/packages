import type { ActiveFile, TabContextMenuState } from '@/components/editor/types';

type EditorTabContextMenuProps = {
  menu: TabContextMenuState | null;
  openFiles: ActiveFile[];
  isFileDirty: (file: ActiveFile) => boolean;
  rightPaneSet: Set<string>;
  onRequestCloseTabs: (ids: Set<string>) => void;
  onSaveFile: (file: ActiveFile) => void;
  onSaveAll: () => void;
  onToggleSide: (fileId: string) => void;
  onDismiss: () => void;
};

export function EditorTabContextMenu({
  menu,
  openFiles,
  isFileDirty,
  rightPaneSet,
  onRequestCloseTabs,
  onSaveFile,
  onSaveAll,
  onToggleSide,
  onDismiss,
}: EditorTabContextMenuProps) {
  if (!menu) return null;
  const file = openFiles.find((item) => item.id === menu.fileId);
  if (!file) return null;
  const index = openFiles.findIndex((item) => item.id === file.id);
  const leftIds = new Set(openFiles.slice(0, index).map((item) => item.id));
  const rightIds = new Set(openFiles.slice(index + 1).map((item) => item.id));
  const savedIds = new Set(
    openFiles.filter((item) => !isFileDirty(item)).map((item) => item.id)
  );
  const allIds = new Set(openFiles.map((item) => item.id));
  const itemClass =
    'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-[#2e2e2e]';
  const disabledClass = 'opacity-50 cursor-not-allowed hover:bg-transparent';

  return (
    <div
      className="fixed z-50 min-w-[220px] rounded border border-[#2a2d2e] bg-[#252526] text-gray-200 shadow-lg"
      style={{ top: menu.y, left: menu.x }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className={itemClass}
        onClick={() => {
          onRequestCloseTabs(new Set([file.id]));
          onDismiss();
        }}
      >
        Close
      </button>
      <button
        className={`${itemClass} ${allIds.size === 0 ? disabledClass : ''}`}
        onClick={() => {
          onRequestCloseTabs(allIds);
          onDismiss();
        }}
        disabled={allIds.size === 0}
      >
        Close All
      </button>
      <button
        className={`${itemClass} ${rightIds.size === 0 ? disabledClass : ''}`}
        onClick={() => {
          onRequestCloseTabs(rightIds);
          onDismiss();
        }}
        disabled={rightIds.size === 0}
      >
        Close to the Right
      </button>
      <button
        className={`${itemClass} ${leftIds.size === 0 ? disabledClass : ''}`}
        onClick={() => {
          onRequestCloseTabs(leftIds);
          onDismiss();
        }}
        disabled={leftIds.size === 0}
      >
        Close to the Left
      </button>
      <button
        className={`${itemClass} ${savedIds.size === 0 ? disabledClass : ''}`}
        onClick={() => {
          onRequestCloseTabs(savedIds);
          onDismiss();
        }}
        disabled={savedIds.size === 0}
      >
        Close Saved
      </button>
      <div className="border-t border-[#2a2d2e]" />
      <button
        className={itemClass}
        onClick={() => {
          onSaveFile(file);
          onDismiss();
        }}
      >
        Save
      </button>
      <button
        className={itemClass}
        onClick={() => {
          onSaveAll();
          onDismiss();
        }}
      >
        Save All
      </button>
      <div className="border-t border-[#2a2d2e]" />
      <button
        className={itemClass}
        onClick={() => {
          onToggleSide(file.id);
          onDismiss();
        }}
      >
        {rightPaneSet.has(file.id) ? 'Close Side' : 'Open in Side'}
      </button>
    </div>
  );
}
