import type React from 'react';
import type { ActiveFile } from '@/components/editor/types';

type EditorTabBarProps = {
  editorView: 'code' | 'preview';
  leftTabs: ActiveFile[];
  rightTabs: ActiveFile[];
  activeFileId: string | null;
  sideFileId: string | null;
  splitRatio: number;
  showExitCompare: boolean;
  isFileDirty: (file: ActiveFile) => boolean;
  onSelectTab: (file: ActiveFile) => void;
  onSelectSideTab: (file: ActiveFile) => void;
  onCloseTab: (id: string) => void;
  onTabDragStart: (event: React.DragEvent<HTMLDivElement>, id: string) => void;
  onTabDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onTabDrop: (
    event: React.DragEvent<HTMLDivElement>,
    targetId: string,
    pane: 'left' | 'right'
  ) => void;
  onTabDragEnd: () => void;
  onTabBarDrop: (event: React.DragEvent<HTMLDivElement>, pane: 'left' | 'right') => void;
  onSplitResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  onTabContextMenu: (
    file: ActiveFile,
    pane: 'left' | 'right',
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  onExitCompare: () => void;
};

export function EditorTabBar({
  editorView,
  leftTabs,
  rightTabs,
  activeFileId,
  sideFileId,
  splitRatio,
  showExitCompare,
  isFileDirty,
  onSelectTab,
  onSelectSideTab,
  onCloseTab,
  onTabDragStart,
  onTabDragOver,
  onTabDrop,
  onTabDragEnd,
  onTabBarDrop,
  onSplitResizeStart,
  onTabContextMenu,
  onExitCompare,
}: EditorTabBarProps) {
  const showSplitEditor = rightTabs.length > 0;

  const renderTab = (file: ActiveFile, isActive: boolean, pane: 'left' | 'right') => (
    <div
      key={file.id}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      draggable
      onDragStart={(event) => onTabDragStart(event, file.id)}
      onDragOver={onTabDragOver}
      onDrop={(event) => onTabDrop(event, file.id, pane)}
      onDragEnd={onTabDragEnd}
      onClick={() => (pane === 'left' ? onSelectTab(file) : onSelectSideTab(file))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          pane === 'left' ? onSelectTab(file) : onSelectSideTab(file);
        }
      }}
      onContextMenu={(event) => onTabContextMenu(file, pane, event)}
      className={`group relative flex h-[30px] cursor-grab select-none items-center gap-1.5 rounded-t-md border pl-2 pr-[0.225rem] py-0.5 text-[11px] active:cursor-grabbing ${
        isActive
          ? 'border-[#2a2d2e] border-b-[#1e1e1e] bg-[#1e1e1e] text-white shadow-[inset_0_1px_0_#2f2f2f]'
          : 'border-transparent text-gray-300 hover:bg-[#2a2d2e] hover:text-white'
      }`}
      title={file.name}
    >
      <span className="flex min-w-0 items-center gap-2">
        {isFileDirty(file) && <span className="h-1.5 w-1.5 rounded-full bg-[#d7ba7d]" />}
        <span className="max-w-[180px] truncate">{file.name}</span>
      </span>
      <button
        type="button"
        aria-label={`Close ${file.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onCloseTab(file.id);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onDragStart={(event) => event.stopPropagation()}
        className={`flex h-5 w-5 items-center justify-center rounded text-[12px] transition ${
          isActive
            ? 'text-gray-300 hover:bg-[#3a3d41] hover:text-white'
            : 'text-gray-400 hover:bg-[#3a3d41] hover:text-white'
        } ${
          isFileDirty(file)
            ? 'opacity-0 group-hover:opacity-100'
            : isActive
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        ×
      </button>
    </div>
  );

  return (
    <div
      className={`relative flex h-[34px] items-stretch border-b border-[#2a2d2e] bg-[#252526] ${
        editorView === 'preview' ? 'hidden' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-stretch">
        <div
          className="flex min-w-0 items-end overflow-x-auto overflow-y-hidden"
          style={
            showSplitEditor
              ? {
                  flexBasis: `${splitRatio * 100}%`,
                  flexGrow: 0,
                  flexShrink: 0,
                }
              : { flexGrow: 1 }
          }
          onDragOver={onTabDragOver}
          onDrop={(event) => onTabBarDrop(event, 'left')}
        >
          <div className="flex min-w-max items-end gap-1 px-2">
            {leftTabs.map((file) => renderTab(file, activeFileId === file.id, 'left'))}
          </div>
        </div>
        {rightTabs.length > 0 && (
          <>
            <div
              className="w-1.5 cursor-col-resize bg-[#2a2d2e] opacity-60 hover:opacity-100"
              onMouseDown={onSplitResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize editor split"
            />
            <div
              className="flex min-w-0 items-end overflow-x-auto overflow-y-hidden"
              style={{
                flexBasis: `${(1 - splitRatio) * 100}%`,
                flexGrow: 0,
                flexShrink: 0,
              }}
              onDragOver={onTabDragOver}
              onDrop={(event) => onTabBarDrop(event, 'right')}
            >
              <div className="flex min-w-max items-end gap-1 px-2">
                {rightTabs.map((file) => renderTab(file, sideFileId === file.id, 'right'))}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 text-[11px] text-gray-300">
        {showExitCompare && (
          <button
            className="rounded border border-[#3c3c3c] px-3 py-1 text-gray-200 hover:bg-[#2a2d2e]"
            onClick={onExitCompare}
          >
            Exit compare
          </button>
        )}
      </div>
    </div>
  );
}
