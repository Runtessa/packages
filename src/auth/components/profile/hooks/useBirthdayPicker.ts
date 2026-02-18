import { Dispatch, SetStateAction, useCallback, useMemo, useRef, useState } from 'react';
import {
  buildCalendarGrid,
  calendarMonthOptionsFor,
  monthLabelFormatterFor,
  monthStart,
  parseDateOnly,
  toDateOnly,
  ProfileDetailsFormState,
} from '../config';

interface UseBirthdayPickerParams {
  copy: {
    birthdayPlaceholder: string;
    calendarLocale: string;
    calendarWeekdays: readonly string[];
  };
  birthdayValue: string;
  setDetailsForm: Dispatch<SetStateAction<ProfileDetailsFormState>>;
}

export const useBirthdayPicker = ({
  copy,
  birthdayValue,
  setDetailsForm,
}: UseBirthdayPickerParams) => {
  const [birthdayPickerOpen, setBirthdayPickerOpen] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState<Date>(() => monthStart(new Date()));
  const birthdayPickerRef = useRef<HTMLDivElement | null>(null);

  const monthLabelFormatter = useMemo(
    () => monthLabelFormatterFor(copy.calendarLocale),
    [copy.calendarLocale],
  );
  const calendarMonthOptions = useMemo(
    () => calendarMonthOptionsFor(copy.calendarLocale),
    [copy.calendarLocale],
  );
  const selectedBirthday = useMemo(() => parseDateOnly(birthdayValue), [birthdayValue]);
  const birthdayCells = useMemo(() => buildCalendarGrid(birthdayMonth), [birthdayMonth]);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const birthdayYearOptions = useMemo(() => {
    const currentYear = today.getFullYear();
    const years: number[] = [];
    for (let year = currentYear; year >= 1900; year -= 1) {
      years.push(year);
    }
    return years;
  }, [today]);

  const birthdayDisplay = selectedBirthday
    ? new Intl.DateTimeFormat(copy.calendarLocale || 'en-US').format(selectedBirthday)
    : copy.birthdayPlaceholder;

  const openBirthdayPicker = useCallback(() => {
    setBirthdayMonth(monthStart(selectedBirthday || new Date()));
    setBirthdayPickerOpen(true);
  }, [selectedBirthday]);

  const closeBirthdayPicker = useCallback(() => {
    setBirthdayPickerOpen(false);
  }, []);

  const toggleBirthdayPicker = useCallback(() => {
    if (birthdayPickerOpen) {
      closeBirthdayPicker();
      return;
    }
    openBirthdayPicker();
  }, [birthdayPickerOpen, closeBirthdayPicker, openBirthdayPicker]);

  const changeBirthdayMonth = useCallback((delta: number) => {
    setBirthdayMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, []);

  const setBirthdayMonthValue = useCallback((month: number) => {
    setBirthdayMonth((prev) => new Date(prev.getFullYear(), month, 1));
  }, []);

  const setBirthdayYearValue = useCallback((year: number) => {
    setBirthdayMonth((prev) => new Date(year, prev.getMonth(), 1));
  }, []);

  const selectBirthday = useCallback(
    (value: Date) => {
      const normalized = new Date(value.getFullYear(), value.getMonth(), value.getDate());
      if (normalized.getTime() > today.getTime()) return;
      setDetailsForm((prev) => ({ ...prev, birthday: toDateOnly(normalized) }));
      setBirthdayPickerOpen(false);
    },
    [setDetailsForm, today],
  );

  return {
    birthdayPickerOpen,
    setBirthdayPickerOpen,
    birthdayMonth,
    birthdayPickerRef,
    monthLabelFormatter,
    calendarMonthOptions,
    selectedBirthday,
    birthdayCells,
    today,
    birthdayYearOptions,
    birthdayDisplay,
    calendarWeekdays: copy.calendarWeekdays,
    openBirthdayPicker,
    closeBirthdayPicker,
    toggleBirthdayPicker,
    changeBirthdayMonth,
    setBirthdayMonthValue,
    setBirthdayYearValue,
    selectBirthday,
  };
};
