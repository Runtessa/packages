import { ComponentType, RefObject } from 'react';
import { FiHome, FiLogOut, FiMoreHorizontal } from 'react-icons/fi';
import { RailKey } from './config';

type MobileItem = {
  key: RailKey;
  icon: ComponentType<{ className?: string }>;
  sectionId: string;
};

type MobileBottomNavProps = {
  dir: 'ltr' | 'rtl';
  activeRail: RailKey;
  railLabels: Record<RailKey, string>;
  mobileBeforeHomeItems: MobileItem[];
  mobileAfterHomeItems: MobileItem[];
  mobileHomeItem: MobileItem | null;
  mobileOverflowItems: MobileItem[];
  mobileMenuRef: RefObject<HTMLDivElement | null>;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  mobileMoreActive: boolean;
  onSelect: (key: RailKey, sectionId: string) => void;
  onLogout: () => void;
  isRtl: boolean;
  moreLabel: string;
  logoutLabel: string;
};

export const MobileBottomNav = ({
  dir,
  activeRail,
  railLabels,
  mobileBeforeHomeItems,
  mobileAfterHomeItems,
  mobileHomeItem,
  mobileOverflowItems,
  mobileMenuRef,
  mobileMenuOpen,
  setMobileMenuOpen,
  mobileMoreActive,
  onSelect,
  onLogout,
  isRtl,
  moreLabel,
  logoutLabel,
}: MobileBottomNavProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E8EAED] bg-white px-2 py-2 md:hidden" dir={dir}>
      <div className="mx-auto grid max-w-[640px] grid-cols-5 gap-1">
        {mobileBeforeHomeItems.map((item) => {
          const Icon = item.icon;
          const active = item.key === activeRail;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key, item.sectionId)}
              className={`flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
                active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
              }`}
            >
              <Icon className="mb-1 h-4 w-4" />
              <span className="leading-tight">{railLabels[item.key]}</span>
            </button>
          );
        })}

        {mobileHomeItem ? (
          <button
            type="button"
            onClick={() => onSelect(mobileHomeItem.key, mobileHomeItem.sectionId)}
            className="flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2"
          >
            <span
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full text-white shadow-[0_6px_14px_rgba(26,115,232,.35)] transition-all duration-200 ${
                activeRail === 'home' ? 'scale-105 bg-[#1765CC]' : 'bg-[#1A73E8]'
              }`}
            >
              <FiHome className="h-5 w-5" />
            </span>
          </button>
        ) : (
          <span />
        )}

        {mobileAfterHomeItems.map((item) => {
          const Icon = item.icon;
          const active = item.key === activeRail;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key, item.sectionId)}
              className={`flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
                active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
              }`}
            >
              <Icon className="mb-1 h-4 w-4" />
              <span className="leading-tight">{railLabels[item.key]}</span>
            </button>
          );
        })}

        <div className="relative flex" ref={mobileMenuRef}>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`flex h-full min-w-0 w-full flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
              mobileMenuOpen || mobileMoreActive ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
            }`}
          >
            <FiMoreHorizontal className="mb-1 h-4 w-4" />
            <span className="leading-tight">{moreLabel}</span>
          </button>

          {mobileMenuOpen ? (
            <div
              className={`absolute bottom-14 z-50 w-52 overflow-hidden rounded-2xl border border-[#E8EAED] bg-white shadow-[0_8px_24px_rgba(60,64,67,.2)] ${
                isRtl ? 'left-0' : 'right-0'
              }`}
            >
              <div className="p-1">
                {mobileOverflowItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.key === activeRail;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onSelect(item.key, item.sectionId)}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-200 ${
                        active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368] hover:bg-[#F1F3F4]'
                      } ${isRtl ? 'text-right' : 'text-left'}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{railLabels[item.key]}</span>
                    </button>
                  );
                })}
                <div className="my-1 h-px bg-[#E8EAED]" />
                <button
                  type="button"
                  onClick={onLogout}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] ${
                    isRtl ? 'text-right' : 'text-left'
                  }`}
                >
                  <FiLogOut className="h-4 w-4" />
                  <span>{logoutLabel}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
};
