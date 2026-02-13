import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveFile } from '@/components/editor/types';

const TAB_SCROLL_STEP = 220;
const SCROLL_EPSILON = 2;

type TabScrollState = {
  canLeft: boolean;
  canRight: boolean;
  hasOverflow: boolean;
};

const DEFAULT_SCROLL_STATE: TabScrollState = {
  canLeft: false,
  canRight: false,
  hasOverflow: false,
};

const getTabScrollState = (element: HTMLDivElement): TabScrollState => {
  const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  return {
    canLeft: element.scrollLeft > SCROLL_EPSILON,
    canRight: maxScrollLeft - element.scrollLeft > SCROLL_EPSILON,
    hasOverflow: maxScrollLeft > SCROLL_EPSILON,
  };
};

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
  const leftTabsRef = useRef<HTMLDivElement | null>(null);
  const rightTabsRef = useRef<HTMLDivElement | null>(null);
  const [leftScrollState, setLeftScrollState] = useState<TabScrollState>(DEFAULT_SCROLL_STATE);
  const [rightScrollState, setRightScrollState] = useState<TabScrollState>(DEFAULT_SCROLL_STATE);

  const updateLeftScrollState = useCallback(() => {
    const element = leftTabsRef.current;
    setLeftScrollState(element ? getTabScrollState(element) : DEFAULT_SCROLL_STATE);
  }, []);

  const updateRightScrollState = useCallback(() => {
    const element = rightTabsRef.current;
    setRightScrollState(element ? getTabScrollState(element) : DEFAULT_SCROLL_STATE);
  }, []);

  const scrollTabs = useCallback(
    (pane: 'left' | 'right', direction: 'left' | 'right') => {
      const target = pane === 'left' ? leftTabsRef.current : rightTabsRef.current;
      if (!target) return;
      const delta = direction === 'left' ? -TAB_SCROLL_STEP : TAB_SCROLL_STEP;
      target.scrollBy({ left: delta, behavior: 'smooth' });
      requestAnimationFrame(() => {
        if (pane === 'left') updateLeftScrollState();
        else updateRightScrollState();
      });
    },
    [updateLeftScrollState, updateRightScrollState]
  );

  useEffect(() => {
    updateLeftScrollState();
    updateRightScrollState();
  }, [leftTabs, rightTabs, splitRatio, updateLeftScrollState, updateRightScrollState]);

  useEffect(() => {
    const handleResize = () => {
      updateLeftScrollState();
      updateRightScrollState();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateLeftScrollState, updateRightScrollState]);

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
          className="flex min-w-0 items-end overflow-hidden"
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
          <div
            ref={leftTabsRef}
            className="hide-scrollbar flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden"
            onScroll={updateLeftScrollState}
          >
            <div className="flex min-w-max items-end gap-1 px-2">
              {leftTabs.map((file) => renderTab(file, activeFileId === file.id, 'left'))}
            </div>
          </div>
          {leftScrollState.hasOverflow && (
            <div className="flex h-full items-center gap-0.5 border-l border-[#2a2d2e] bg-[#252526] px-1">
              <button
                type="button"
                onClick={() => scrollTabs('left', 'left')}
                disabled={!leftScrollState.canLeft}
                aria-label="Scroll tabs left"
                className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-300 transition hover:bg-[#2a2d2e] hover:text-white disabled:cursor-default disabled:opacity-35"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => scrollTabs('left', 'right')}
                disabled={!leftScrollState.canRight}
                aria-label="Scroll tabs right"
                className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-300 transition hover:bg-[#2a2d2e] hover:text-white disabled:cursor-default disabled:opacity-35"
              >
                ▶
              </button>
            </div>
          )}
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
              className="flex min-w-0 items-end overflow-hidden"
              style={{
                flexBasis: `${(1 - splitRatio) * 100}%`,
                flexGrow: 0,
                flexShrink: 0,
              }}
              onDragOver={onTabDragOver}
              onDrop={(event) => onTabBarDrop(event, 'right')}
            >
              <div
                ref={rightTabsRef}
                className="hide-scrollbar flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden"
                onScroll={updateRightScrollState}
              >
                <div className="flex min-w-max items-end gap-1 px-2">
                  {rightTabs.map((file) => renderTab(file, sideFileId === file.id, 'right'))}
                </div>
              </div>
              {rightScrollState.hasOverflow && (
                <div className="flex h-full items-center gap-0.5 border-l border-[#2a2d2e] bg-[#252526] px-1">
                  <button
                    type="button"
                    onClick={() => scrollTabs('right', 'left')}
                    disabled={!rightScrollState.canLeft}
                    aria-label="Scroll side tabs left"
                    className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-300 transition hover:bg-[#2a2d2e] hover:text-white disabled:cursor-default disabled:opacity-35"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollTabs('right', 'right')}
                    disabled={!rightScrollState.canRight}
                    aria-label="Scroll side tabs right"
                    className="flex h-5 w-5 items-center justify-center rounded text-[11px] text-gray-300 transition hover:bg-[#2a2d2e] hover:text-white disabled:cursor-default disabled:opacity-35"
                  >
                    ▶
                  </button>
                </div>
              )}
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
