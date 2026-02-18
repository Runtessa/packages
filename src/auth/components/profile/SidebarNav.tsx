import { FiLogOut } from 'react-icons/fi';
import { RailKey, railItems } from './config';

type SidebarNavProps = {
  activeRail: RailKey;
  railLabels: Record<RailKey, string>;
  onSelect: (key: RailKey, sectionId: string) => void;
  onLogout: () => void;
  isRtl: boolean;
  cardClass: string;
  desktopRailLeft: string;
  logoutLabel: string;
};

export const SidebarNav = ({
  activeRail,
  railLabels,
  onSelect,
  onLogout,
  isRtl,
  cardClass,
  desktopRailLeft,
  logoutLabel,
}: SidebarNavProps) => {
  return (
    <aside className="hidden w-[280px] shrink-0 md:block">
      <nav
        className={`${cardClass} md:fixed md:top-6 md:w-[280px] md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:hide-scrollbar p-3`}
        style={isRtl ? { right: desktopRailLeft } : { left: desktopRailLeft }}
      >
        <div className="grid h-24 place-items-center" style={{ marginBottom: '32px' }}>
          <img src="/images/lw_dark.png" alt="ADA" className="h-14 w-auto" />
        </div>
        <ul className="space-y-1">
          {railItems.map((item) => {
            const Icon = item.icon;
            const active = item.key === activeRail;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onSelect(item.key, item.sectionId)}
                  className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-normal transition-all duration-200 ${
                    active
                      ? 'bg-[#E8F0FE] text-[#1A73E8]'
                      : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
                  } ${isRtl ? 'text-right' : 'text-left'}`}
                >
                  <Icon className="h-6 w-6" />
                  <span>{railLabels[item.key]}</span>
                </button>
              </li>
            );
          })}
          <li className="pt-2">
            <button
              type="button"
              onClick={onLogout}
              className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] ${isRtl ? 'text-right' : 'text-left'}`}
            >
              <FiLogOut className="h-6 w-6" />
              <span>{logoutLabel}</span>
            </button>
          </li>
        </ul>
      </nav>
    </aside>
  );
};
