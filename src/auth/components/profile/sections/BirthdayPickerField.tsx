import { FiCalendar, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { RefObject } from 'react';
import { isSameDay, toDateOnly } from '../config';
import { ProfileCopy } from './types';

type BirthdayPickerFieldProps = {
  copy: ProfileCopy;
  inputClass: string;
  isRtl: boolean;
  birthdayPickerRef: RefObject<HTMLDivElement | null>;
  birthdayPickerOpen: boolean;
  birthdayDisplay: string;
  birthdayMonth: Date;
  calendarMonthOptions: Array<{ value: number; label: string }>;
  birthdayYearOptions: number[];
  monthLabelFormatter: Intl.DateTimeFormat;
  calendarWeekdays: readonly string[];
  birthdayCells: Array<Date | null>;
  selectedBirthday: Date | null;
  today: Date;
  onTogglePicker: () => void;
  onSetPickerOpen: (open: boolean) => void;
  onSetBirthdayMonthValue: (month: number) => void;
  onSetBirthdayYearValue: (year: number) => void;
  onChangeBirthdayMonth: (delta: number) => void;
  onSelectBirthday: (value: Date) => void;
  onClearBirthday: () => void;
};

export const BirthdayPickerField = ({
  copy,
  inputClass,
  isRtl,
  birthdayPickerRef,
  birthdayPickerOpen,
  birthdayDisplay,
  birthdayMonth,
  calendarMonthOptions,
  birthdayYearOptions,
  monthLabelFormatter,
  calendarWeekdays,
  birthdayCells,
  selectedBirthday,
  today,
  onTogglePicker,
  onSetPickerOpen,
  onSetBirthdayMonthValue,
  onSetBirthdayYearValue,
  onChangeBirthdayMonth,
  onSelectBirthday,
  onClearBirthday,
}: BirthdayPickerFieldProps) => {
  return (
    <div>
      <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.birthday}</label>
      <div ref={birthdayPickerRef} className="relative">
        <button
          type="button"
          className={`${inputClass} flex items-center justify-between ${isRtl ? 'text-right' : 'text-left'}`}
          onClick={onTogglePicker}
        >
          <span className={selectedBirthday ? 'text-[#202124]' : 'text-[#5F6368]'}>{birthdayDisplay}</span>
          <FiCalendar className="h-4 w-4 text-[#5F6368]" />
        </button>

        {birthdayPickerOpen ? (
          <div className="absolute left-0 z-30 mt-2 w-[clamp(16rem,100%,19rem)] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#DADCE0] bg-white p-4 shadow-[0_16px_28px_-18px_rgba(32,33,36,0.45)]">
            <div className="mb-3 space-y-2">
              <div className="grid grid-cols-[1fr,110px] gap-2">
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-xl border border-[#DADCE0] bg-white px-3 py-2 pr-8 text-sm text-[#202124] outline-none transition-all focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20"
                    value={birthdayMonth.getMonth()}
                    onChange={(event) => onSetBirthdayMonthValue(Number(event.target.value))}
                  >
                    {calendarMonthOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <FiChevronRight className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-[#5F6368]" />
                </div>
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-xl border border-[#DADCE0] bg-white px-3 py-2 pr-8 text-sm text-[#202124] outline-none transition-all focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20"
                    value={birthdayMonth.getFullYear()}
                    onChange={(event) => onSetBirthdayYearValue(Number(event.target.value))}
                  >
                    {birthdayYearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                  <FiChevronRight className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-[#5F6368]" />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] transition-colors hover:bg-[#F1F3F4] hover:text-[#202124]"
                  onClick={() => onChangeBirthdayMonth(-1)}
                  aria-label={copy.previousMonth}
                >
                  <FiChevronLeft className="h-4 w-4" />
                </button>
                <p className="text-xs font-medium text-[#5F6368]">{monthLabelFormatter.format(birthdayMonth)}</p>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] transition-colors hover:bg-[#F1F3F4] hover:text-[#202124]"
                  onClick={() => onChangeBirthdayMonth(1)}
                  aria-label={copy.nextMonth}
                >
                  <FiChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 pb-1">
              {calendarWeekdays.map((weekday) => (
                <span key={weekday} className="text-center text-[11px] uppercase tracking-[0.08em] text-[#5F6368]">
                  {weekday}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {birthdayCells.map((day, index) => {
                if (!day) return <span key={`empty-${index}`} className="h-9 w-9" />;

                const selected = isSameDay(selectedBirthday, day);
                const inFuture = day.getTime() > today.getTime();
                return (
                  <button
                    key={toDateOnly(day)}
                    type="button"
                    className={`h-9 w-9 rounded-xl text-sm transition-all ${
                      selected
                        ? 'bg-[#1A73E8] font-medium text-white'
                        : 'text-[#202124] hover:bg-[#E8F0FE] hover:text-[#1A73E8]'
                    } ${inFuture ? 'cursor-not-allowed opacity-35 hover:bg-transparent hover:text-[#202124]' : ''}`}
                    onClick={() => onSelectBirthday(day)}
                    disabled={inFuture}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-[#5F6368] transition-colors hover:bg-[#F1F3F4]"
                onClick={onClearBirthday}
              >
                {copy.clear}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full bg-[#1A73E8] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1765cc]"
                onClick={() => onSetPickerOpen(false)}
              >
                {copy.done}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
