import { RefObject } from 'react';
import {
  CountryOption,
  COUNTRY_OPTIONS,
  countryPlaceholder,
} from './config';

type PhoneInputProps = {
  fieldId: string;
  isRtl: boolean;
  selectedCountry: CountryOption;
  formattedNationalPhone: string;
  countryPickerOpen: boolean;
  setCountryPickerOpen: (open: boolean) => void;
  countryPickerRef: RefObject<HTMLDivElement | null>;
  onCountryChange: (code: string) => void;
  onPhoneInputChange: (value: string) => void;
  countryNames: Record<string, string>;
  phoneLabel: string;
};

export const PhoneInput = ({
  fieldId,
  isRtl,
  selectedCountry,
  formattedNationalPhone,
  countryPickerOpen,
  setCountryPickerOpen,
  countryPickerRef,
  onCountryChange,
  onPhoneInputChange,
  countryNames,
  phoneLabel,
}: PhoneInputProps) => {
  return (
    <div>
      <label htmlFor={fieldId} className={`mb-1 block text-sm font-medium text-[#202124] ${isRtl ? 'text-right' : 'text-left'}`}>
        {phoneLabel}
      </label>
      <div className="relative flex min-h-[48px] items-center overflow-visible rounded-2xl border border-[#DADCE0] bg-white shadow-[0_1px_2px_0_rgba(60,64,67,.12)] focus-within:border-[#1A73E8] focus-within:ring-2 focus-within:ring-[#1A73E8]/20">
        <div className="relative shrink-0" ref={countryPickerRef}>
          <button
            type="button"
            onClick={() => setCountryPickerOpen(!countryPickerOpen)}
            className={`flex h-[48px] items-center gap-2 rounded-l-2xl px-3 transition-colors hover:bg-[#F8F9FA] ${isRtl ? 'border-l border-[#E6EBF2]' : 'border-r border-[#E6EBF2]'}`}
            aria-haspopup="listbox"
            aria-expanded={countryPickerOpen}
          >
            <span className="text-base leading-none">{selectedCountry.flag}</span>
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-[#5F6368]" aria-hidden>
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.176l3.71-3.946a.75.75 0 1 1 1.08 1.04l-4.25 4.52a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {countryPickerOpen ? (
            <div className="hide-scrollbar absolute left-0 top-[calc(100%+10px)] z-30 max-h-72 w-72 overflow-y-auto rounded-2xl border border-[#DBE1EC] bg-white/95 p-1.5 shadow-[0_20px_50px_-30px_rgba(32,33,36,0.65)] backdrop-blur">
              {COUNTRY_OPTIONS.map((country) => (
                <button
                  key={country.code}
                  type="button"
                  className={`group flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    selectedCountry.code === country.code ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#202124] hover:bg-[#F3F7FF]'
                  } ${isRtl ? 'text-right' : 'text-left'}`}
                  onClick={() => onCountryChange(country.code)}
                >
                  <span className="text-lg">{country.flag}</span>
                  <span className="truncate font-medium">{countryNames[country.code] || country.name}</span>
                  <span className="ml-auto text-xs font-semibold text-[#5F6368] group-hover:text-[#3E506E]">{country.dialCode}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <span className="shrink-0 border-r border-[#E6EBF2] px-3 text-left text-sm font-semibold text-[#4A5A73]" dir="ltr">
          {selectedCountry.dialCode}
        </span>
        <input
          id={fieldId}
          className="h-[48px] min-w-0 w-full rounded-r-2xl border-0 bg-transparent px-3 text-left text-sm text-[#202124] outline-none placeholder:text-[#9AA0A6]"
          type="tel"
          dir="ltr"
          value={formattedNationalPhone}
          onChange={(event) => onPhoneInputChange(event.target.value)}
          placeholder={countryPlaceholder(selectedCountry)}
          autoComplete="tel-national"
          required
        />
      </div>
    </div>
  );
};
