import { useEffect, useRef, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import { localeDir, UiLocale, UI_LOCALE_OPTIONS } from '../../lib/ui/locale';
import { getAuthMessages } from '../../lib/ui/i18n';

type LanguageToggleProps = {
  locale: UiLocale;
  onChange: (next: UiLocale) => void;
  className?: string;
  variant?: 'default' | 'inline';
};

export const LanguageToggle = ({ locale, onChange, className = '', variant = 'default' }: LanguageToggleProps) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const current = UI_LOCALE_OPTIONS.find((item) => item.value === locale) || UI_LOCALE_OPTIONS[0];
  const panelAlignClass = localeDir(locale) === 'rtl' ? 'left-0' : 'right-0';
  const ariaLabel = getAuthMessages(locale).common.selectLanguage;

  useEffect(() => {
    if (!open) return;

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={`relative ${className}`.trim()}>
      <button
        type="button"
        className={`inline-flex items-center gap-2 text-xs font-semibold text-[#202124] transition-all duration-200 ${
          variant === 'inline'
            ? 'h-8 rounded-full bg-transparent px-2 hover:bg-[#F1F3F4]'
            : 'h-10 rounded-2xl border border-[#D6DCE8] bg-white px-3 shadow-[0_8px_22px_-20px_rgba(26,115,232,0.85)] hover:border-[#BCD0F5] hover:bg-[#F4F8FF]'
        }`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span>{current.label}</span>
        <FiChevronDown className={`h-4 w-4 text-[#5F6368] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          className={`absolute ${panelAlignClass} top-[calc(100%+10px)] z-[95] w-44 overflow-hidden rounded-2xl border border-[#DBE1EC] bg-white/95 p-1.5 shadow-[0_20px_50px_-30px_rgba(32,33,36,0.65)] backdrop-blur`}
        >
          {UI_LOCALE_OPTIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                locale === item.value ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#202124] hover:bg-[#F3F7FF]'
              }`}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
            >
              <span className="text-lg">{item.flag}</span>
              <span className="truncate font-medium">{item.label}</span>
              <span className="ml-auto text-[11px] font-semibold uppercase text-[#5F6368]">{item.value}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default LanguageToggle;
