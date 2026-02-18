import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CountryCode,
  CountryOption,
  DEFAULT_COUNTRY_CODE,
  countryByCode,
  formatNationalNumber,
  normalizeNationalDigits,
  parsePhoneNumber,
} from '../config';

export const usePhoneNumberState = () => {
  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode>(DEFAULT_COUNTRY_CODE);
  const [phoneNationalDigits, setPhoneNationalDigits] = useState('');
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const countryPickerRef = useRef<HTMLDivElement | null>(null);

  const selectedCountry = useMemo(() => countryByCode(selectedCountryCode), [selectedCountryCode]);
  const formattedNationalPhone = useMemo(
    () => formatNationalNumber(selectedCountry, phoneNationalDigits),
    [selectedCountry, phoneNationalDigits],
  );

  const fullPhoneNumber = useMemo(() => {
    const normalized = normalizeNationalDigits(selectedCountry, phoneNationalDigits);
    return normalized ? `${selectedCountry.dialCode}${normalized}` : '';
  }, [selectedCountry, phoneNationalDigits]);

  const applyPhoneValue = (value: string) => {
    const parsed = parsePhoneNumber(value);
    setSelectedCountryCode(parsed.countryCode);
    setPhoneNationalDigits(parsed.nationalDigits);
  };

  const handleCountryChange = (nextCode: string) => {
    const nextCountry = countryByCode(nextCode);
    setSelectedCountryCode(nextCountry.code);
    setPhoneNationalDigits((current) => normalizeNationalDigits(nextCountry, current));
    setCountryPickerOpen(false);
  };

  const handlePhoneInputChange = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.startsWith('+')) {
      applyPhoneValue(trimmed);
      return;
    }
    setPhoneNationalDigits(normalizeNationalDigits(selectedCountry, value));
  };

  useEffect(() => {
    if (!countryPickerOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!countryPickerRef.current) return;
      const target = event.target as Node | null;
      if (target && countryPickerRef.current.contains(target)) return;
      setCountryPickerOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCountryPickerOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [countryPickerOpen]);

  return {
    selectedCountry,
    formattedNationalPhone,
    fullPhoneNumber,
    countryPickerOpen,
    setCountryPickerOpen,
    countryPickerRef,
    setPhoneNationalDigits,
    setSelectedCountryCode,
    applyPhoneValue,
    handleCountryChange,
    handlePhoneInputChange,
  };
};

export type PhoneNumberState = ReturnType<typeof usePhoneNumberState>;
export type SelectedCountry = CountryOption;
