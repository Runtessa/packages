export const one = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] || '' : value || '';

export const tenantFromReturnTo = (returnTo: string): string => {
  if (!returnTo || !returnTo.startsWith('/')) return '';
  try {
    const parsed = new URL(returnTo, 'http://local.auth');
    const redirectUri = parsed.searchParams.get('redirect_uri') || '';
    if (!redirectUri) return '';
    return new URL(redirectUri).hostname || '';
  } catch {
    return '';
  }
};

export const tenantOrgIdFromReturnTo = (returnTo: string): string => {
  if (!returnTo || !returnTo.startsWith('/')) return '';
  try {
    const parsed = new URL(returnTo, 'http://local.auth');
    return parsed.searchParams.get('tenant_org_id') || parsed.searchParams.get('org_id') || '';
  } catch {
    return '';
  }
};

export const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition-all duration-200 focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20';
export const primaryBtnClass =
  'inline-flex min-h-[42px] min-w-[124px] items-center justify-center gap-2 rounded-xl border border-[#1669D9] bg-[#1A73E8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_-18px_rgba(26,115,232,0.95)] transition-all duration-200 hover:-translate-y-[1px] hover:bg-[#1765CC] hover:shadow-[0_18px_34px_-20px_rgba(26,115,232,0.9)] active:translate-y-0 active:shadow-[0_8px_20px_-16px_rgba(26,115,232,0.85)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0';
export const secondaryBtnClass =
  'inline-flex min-h-[42px] min-w-[124px] items-center justify-center gap-2 rounded-xl border border-[#D3DBE8] bg-white px-5 py-2.5 text-sm font-semibold text-[#2D4F86] transition-all duration-200 hover:-translate-y-[1px] hover:border-[#BFCAE0] hover:bg-[#F7FAFF] hover:text-[#1A73E8] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50';
export const tinyLinkClass =
  'inline-flex min-h-[38px] items-center justify-center rounded-xl border border-[#D7DDE8] bg-white px-4 text-xs font-semibold text-[#315A9A] transition-all duration-200 hover:border-[#BCD0F5] hover:bg-[#F4F8FF] hover:text-[#1A73E8] active:bg-[#EDF4FF] disabled:cursor-not-allowed disabled:opacity-50';
export const inlineLinkClass =
  'text-xs font-semibold text-[#1A73E8] transition-colors duration-150 hover:text-[#1765CC] hover:underline disabled:cursor-not-allowed disabled:opacity-50';
export const tabBaseClass = 'inline-flex items-center rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-300';

export type Mode = 'signin' | 'signup';
export type SigninStep = 'phone' | 'password' | 'otp' | 'twofactor';
export type SignupStep = 'phone' | 'otp';
export type ToastType = 'success' | 'error';
export type OtpContext = 'signin' | 'signup';
export type CountryCode = 'IR' | 'US' | 'GB' | 'TR' | 'DE' | 'AE' | 'IQ' | 'IN';

export interface CountryOption {
  code: CountryCode;
  name: string;
  flag: string;
  dialCode: string;
  localLength: number;
  groups: number[];
}

export interface ToastEntry {
  id: number;
  type: ToastType;
  message: string;
}

export interface OtpProgressState {
  mode: Mode;
  step: 'otp' | 'twofactor';
  phoneNumber: string;
  otpWaitUntilMs: number;
  savedAt: number;
}

export const OTP_PROGRESS_STORAGE_KEY = 'idp-auth-login-otp-progress-v1';

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'IR', name: 'Iran', flag: '🇮🇷', dialCode: '+98', localLength: 10, groups: [3, 3, 4] },
  { code: 'US', name: 'United States', flag: '🇺🇸', dialCode: '+1', localLength: 10, groups: [3, 3, 4] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dialCode: '+44', localLength: 10, groups: [4, 3, 3] },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', dialCode: '+90', localLength: 10, groups: [3, 3, 4] },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', dialCode: '+49', localLength: 11, groups: [3, 4, 4] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', dialCode: '+971', localLength: 9, groups: [2, 3, 4] },
  { code: 'IQ', name: 'Iraq', flag: '🇮🇶', dialCode: '+964', localLength: 10, groups: [3, 3, 4] },
  { code: 'IN', name: 'India', flag: '🇮🇳', dialCode: '+91', localLength: 10, groups: [5, 5] },
];

export const DEFAULT_COUNTRY_CODE: CountryCode = 'IR';

const digitsOnly = (value: string): string => value.replace(/\D+/g, '');

export const countryByCode = (code: string): CountryOption =>
  COUNTRY_OPTIONS.find((item) => item.code === code) || COUNTRY_OPTIONS[0];

export const normalizeNationalDigits = (country: CountryOption, value: string): string => {
  let digits = digitsOnly(value);
  const dialDigits = digitsOnly(country.dialCode);
  if (digits.length > country.localLength && dialDigits && digits.startsWith(dialDigits)) {
    digits = digits.slice(dialDigits.length);
  }
  if (digits.length > country.localLength && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, country.localLength);
};

export const formatWithGroups = (digits: string, groups: number[]): string => {
  let cursor = 0;
  const chunks: string[] = [];
  for (const size of groups) {
    if (cursor >= digits.length) break;
    chunks.push(digits.slice(cursor, cursor + size));
    cursor += size;
  }
  if (cursor < digits.length) chunks.push(digits.slice(cursor));
  return chunks.join(' ');
};

export const formatNationalNumber = (country: CountryOption, value: string): string =>
  formatWithGroups(normalizeNationalDigits(country, value), country.groups);

export const countryPlaceholder = (country: CountryOption): string => {
  const mask = formatWithGroups('0'.repeat(country.localLength), country.groups);
  return mask || '0000000000';
};

export const parsePhoneNumber = (value: string): { countryCode: CountryCode; nationalDigits: string } => {
  const compact = String(value || '').trim();
  if (!compact) return { countryCode: DEFAULT_COUNTRY_CODE, nationalDigits: '' };

  const normalized = compact.startsWith('+') ? compact : `+${digitsOnly(compact)}`;
  const sorted = [...COUNTRY_OPTIONS].sort((a, b) => b.dialCode.length - a.dialCode.length);
  for (const item of sorted) {
    if (normalized.startsWith(item.dialCode)) {
      const rest = normalized.slice(item.dialCode.length);
      return { countryCode: item.code, nationalDigits: normalizeNationalDigits(item, rest) };
    }
  }

  const fallbackCountry = countryByCode(DEFAULT_COUNTRY_CODE);
  return {
    countryCode: fallbackCountry.code,
    nationalDigits: normalizeNationalDigits(fallbackCountry, compact),
  };
};

export const formatCountdown = (totalSec: number): string => {
  const safe = Math.max(0, totalSec);
  const min = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const sec = (safe % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

export const parseJsonSafe = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const data = await response.json();
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
};
