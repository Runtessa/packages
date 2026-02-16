import { useEffect, useState } from 'react';

export type UiLocale = 'fa' | 'en' | 'de' | 'ar';
export type UiTextLocale = 'fa' | 'en';

const LOCALE_STORAGE_KEY = 'auth.ui.locale';
const LOCALE_EVENT = 'auth.ui.locale.changed';
const DEFAULT_LOCALE: UiLocale = 'fa';

const LOCALE_META: Record<
  UiLocale,
  {
    langTag: string;
    dir: 'rtl' | 'ltr';
    textLocale: UiTextLocale;
  }
> = {
  fa: { langTag: 'fa', dir: 'rtl', textLocale: 'fa' },
  en: { langTag: 'en', dir: 'ltr', textLocale: 'en' },
  de: { langTag: 'de', dir: 'ltr', textLocale: 'en' },
  ar: { langTag: 'ar', dir: 'rtl', textLocale: 'en' },
};

export const UI_LOCALE_OPTIONS: Array<{ value: UiLocale; label: string; flag: string }> = [
  { value: 'fa', label: 'فارسی', flag: '🇮🇷' },
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'ar', label: 'العربية', flag: '🇸🇦' },
];

const normalizeLocale = (value: unknown): UiLocale => {
  if (value === 'en' || value === 'de' || value === 'ar' || value === 'fa') return value;
  return DEFAULT_LOCALE;
};

export const localeDir = (locale: UiLocale): 'rtl' | 'ltr' => {
  return LOCALE_META[locale].dir;
};

export const localeText = (locale: UiLocale): UiTextLocale => {
  return LOCALE_META[locale].textLocale;
};

export const useUiLocale = () => {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    setLocaleState(stored);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      setLocaleState(normalizeLocale(event.newValue));
    };

    const onLocaleEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ locale?: unknown }>;
      setLocaleState(normalizeLocale(customEvent.detail?.locale));
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(LOCALE_EVENT, onLocaleEvent as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(LOCALE_EVENT, onLocaleEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = LOCALE_META[locale].langTag;
      document.documentElement.dir = localeDir(locale);
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }
  }, [locale]);

  const setLocale = (next: UiLocale) => {
    setLocaleState(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: { locale: next } }));
    }
  };

  return {
    locale,
    isRtl: localeDir(locale) === 'rtl',
    setLocale,
  };
};
