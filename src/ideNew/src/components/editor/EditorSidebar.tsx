import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  FiArrowLeftCircle,
  FiClock,
  FiFlag,
  FiFolder,
  FiMessageSquare,
  FiSearch,
} from 'react-icons/fi';

type LeftPanelKey = 'explorer' | 'search' | 'history' | 'staging';

type EditorSidebarProps = {
  leftPanel: LeftPanelKey;
  onSelectPanel: (panel: LeftPanelKey) => void;
  onTogglePanel: (panel: LeftPanelKey) => void;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  sidebarLabel: string;
  sidebarLabelTone: string;
  exitHref: string;
};

export function EditorSidebar({
  leftPanel,
  onSelectPanel,
  onTogglePanel,
  assistantOpen,
  onToggleAssistant,
  sidebarLabel,
  sidebarLabelTone,
  exitHref,
}: EditorSidebarProps) {
  const makeButton = (panel: LeftPanelKey, title: string, icon: ReactNode) => (
    <button
      title={title}
      className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
        leftPanel === panel
          ? 'bg-[#094771] text-white'
          : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
      }`}
      onClick={() => onSelectPanel(panel)}
      onDoubleClick={() => onTogglePanel(panel)}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-[#2a2d2e] bg-[#1b1b1b] py-2">
      {makeButton('explorer', 'Explorer', <FiFolder />)}
      {makeButton('search', 'Search', <FiSearch />)}
      {makeButton('history', 'History', <FiClock />)}
      {makeButton('staging', 'Staging', <FiFlag />)}
      <button
        title={assistantOpen ? 'Hide Assistant' : 'Show Assistant'}
        className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-base transition ${
          assistantOpen
            ? 'bg-[#094771] text-white'
            : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
        }`}
        onClick={onToggleAssistant}
      >
        <FiMessageSquare />
      </button>
      <div className="mt-auto flex w-full flex-col items-center px-1 pb-2">
        <div
          className={`flex w-full flex-col items-center gap-2 px-1 py-2 text-[10px] ${sidebarLabelTone}`}
          title={sidebarLabel}
        >
          <span
            className="font-semibold"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {sidebarLabel}
          </span>
        </div>
        <Link
          href={exitHref}
          title="Exit editor"
          className="mt-2 flex h-8 w-8 items-center justify-center rounded-lg text-base text-gray-400 transition hover:bg-[#2a2d2e] hover:text-gray-200"
        >
          <FiArrowLeftCircle />
        </Link>
      </div>
    </div>
  );
}
