import Head from 'next/head';
import Image from 'next/image';
import { ClipboardEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import branding from '../branding.json';
import { LanguageToggle } from '../components/ui/LanguageToggle';
import { localeDir, useUiLocale } from '../lib/ui/locale';
import { getAuthMessages } from '../lib/ui/i18n';

const one = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] || '' : value || '';

const tenantFromReturnTo = (returnTo: string): string => {
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

const tenantOrgIdFromReturnTo = (returnTo: string): string => {
  if (!returnTo || !returnTo.startsWith('/')) return '';
  try {
    const parsed = new URL(returnTo, 'http://local.auth');
    return parsed.searchParams.get('tenant_org_id') || parsed.searchParams.get('org_id') || '';
  } catch {
    return '';
  }
};

const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition-all duration-200 focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20';
const primaryBtnClass =
  'inline-flex min-h-[42px] min-w-[124px] items-center justify-center gap-2 rounded-xl border border-[#1669D9] bg-[#1A73E8] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_-18px_rgba(26,115,232,0.95)] transition-all duration-200 hover:-translate-y-[1px] hover:bg-[#1765CC] hover:shadow-[0_18px_34px_-20px_rgba(26,115,232,0.9)] active:translate-y-0 active:shadow-[0_8px_20px_-16px_rgba(26,115,232,0.85)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0';
const secondaryBtnClass =
  'inline-flex min-h-[42px] min-w-[124px] items-center justify-center gap-2 rounded-xl border border-[#D3DBE8] bg-white px-5 py-2.5 text-sm font-semibold text-[#2D4F86] transition-all duration-200 hover:-translate-y-[1px] hover:border-[#BFCAE0] hover:bg-[#F7FAFF] hover:text-[#1A73E8] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50';
const tinyLinkClass =
  'inline-flex min-h-[38px] items-center justify-center rounded-xl border border-[#D7DDE8] bg-white px-4 text-xs font-semibold text-[#315A9A] transition-all duration-200 hover:border-[#BCD0F5] hover:bg-[#F4F8FF] hover:text-[#1A73E8] active:bg-[#EDF4FF] disabled:cursor-not-allowed disabled:opacity-50';
const inlineLinkClass =
  'text-xs font-semibold text-[#1A73E8] transition-colors duration-150 hover:text-[#1765CC] hover:underline disabled:cursor-not-allowed disabled:opacity-50';
const tabBaseClass = 'inline-flex items-center rounded-full px-4 py-1.5 text-xs font-medium transition-all duration-300';

type Mode = 'signin' | 'signup';
type SigninStep = 'phone' | 'password' | 'otp' | 'twofactor';
type SignupStep = 'phone' | 'otp';
type ToastType = 'success' | 'error';
type OtpContext = 'signin' | 'signup';
type CountryCode = 'IR' | 'US' | 'GB' | 'TR' | 'DE' | 'AE' | 'IQ' | 'IN';

interface CountryOption {
  code: CountryCode;
  name: string;
  flag: string;
  dialCode: string;
  localLength: number;
  groups: number[];
}

interface ToastEntry {
  id: number;
  type: ToastType;
  message: string;
}

interface OtpProgressState {
  mode: Mode;
  step: 'otp' | 'twofactor';
  phoneNumber: string;
  otpWaitUntilMs: number;
  savedAt: number;
}

const OTP_PROGRESS_STORAGE_KEY = 'idp-auth-login-otp-progress-v1';

const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'IR', name: 'Iran', flag: '🇮🇷', dialCode: '+98', localLength: 10, groups: [3, 3, 4] },
  { code: 'US', name: 'United States', flag: '🇺🇸', dialCode: '+1', localLength: 10, groups: [3, 3, 4] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', dialCode: '+44', localLength: 10, groups: [4, 3, 3] },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', dialCode: '+90', localLength: 10, groups: [3, 3, 4] },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', dialCode: '+49', localLength: 11, groups: [3, 4, 4] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', dialCode: '+971', localLength: 9, groups: [2, 3, 4] },
  { code: 'IQ', name: 'Iraq', flag: '🇮🇶', dialCode: '+964', localLength: 10, groups: [3, 3, 4] },
  { code: 'IN', name: 'India', flag: '🇮🇳', dialCode: '+91', localLength: 10, groups: [5, 5] },
];

const DEFAULT_COUNTRY_CODE: CountryCode = 'IR';

const digitsOnly = (value: string): string => value.replace(/\D+/g, '');

const countryByCode = (code: string): CountryOption =>
  COUNTRY_OPTIONS.find((item) => item.code === code) || COUNTRY_OPTIONS[0];

const normalizeNationalDigits = (country: CountryOption, value: string): string => {
  let digits = digitsOnly(value);
  const dialDigits = digitsOnly(country.dialCode);
  if (digits.length > country.localLength && dialDigits && digits.startsWith(dialDigits)) {
    digits = digits.slice(dialDigits.length);
  }
  if (digits.length > country.localLength && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, country.localLength);
};

const formatWithGroups = (digits: string, groups: number[]): string => {
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

const formatNationalNumber = (country: CountryOption, value: string): string =>
  formatWithGroups(normalizeNationalDigits(country, value), country.groups);

const countryPlaceholder = (country: CountryOption): string => {
  const mask = formatWithGroups('0'.repeat(country.localLength), country.groups);
  return mask || '0000000000';
};

const parsePhoneNumber = (value: string): { countryCode: CountryCode; nationalDigits: string } => {
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

const formatCountdown = (totalSec: number): string => {
  const safe = Math.max(0, totalSec);
  const min = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0');
  const sec = (safe % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
};

const parseJsonSafe = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const data = await response.json();
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
};

export default function LoginPage() {
  const router = useRouter();
  const { locale, isRtl, setLocale } = useUiLocale();
  const copy = getAuthMessages(locale).login;
  const [mode, setMode] = useState<Mode>('signin');
  const [signinStep, setSigninStep] = useState<SigninStep>('phone');
  const [signupStep, setSignupStep] = useState<SignupStep>('phone');

  const [allowRegistration, setAllowRegistration] = useState(true);

  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode>(DEFAULT_COUNTRY_CODE);
  const [phoneNationalDigits, setPhoneNationalDigits] = useState('');
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [signinOtpDigits, setSigninOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [signupOtpDigits, setSignupOtpDigits] = useState<string[]>(Array(6).fill(''));

  const [otpWaitUntilMs, setOtpWaitUntilMs] = useState(0);
  const [resendRemainingSec, setResendRemainingSec] = useState(0);

  const [busyAction, setBusyAction] = useState<string>('');
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(1);
  const signinOtpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const signupOtpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const countryPickerRef = useRef<HTMLDivElement | null>(null);

  const returnTo = one(router.query.returnTo) || '/profile';
  const clientId = one(router.query.client_id);
  const tenantName = one(router.query.tenant_name) || tenantFromReturnTo(returnTo);
  const tenantOrgRandId = one(router.query.tenant_org_id) || tenantOrgIdFromReturnTo(returnTo);
  const loginTitle = tenantName ? `${copy.access} ${tenantName}` : copy.loginToProfile;

  const selectedCountry = useMemo(() => countryByCode(selectedCountryCode), [selectedCountryCode]);
  const formattedNationalPhone = useMemo(
    () => formatNationalNumber(selectedCountry, phoneNationalDigits),
    [selectedCountry, phoneNationalDigits],
  );
  const fullPhoneNumber = useMemo(() => {
    const normalized = normalizeNationalDigits(selectedCountry, phoneNationalDigits);
    return normalized ? `${selectedCountry.dialCode}${normalized}` : '';
  }, [selectedCountry, phoneNationalDigits]);
  const clearOtpProgress = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(OTP_PROGRESS_STORAGE_KEY);
  };

  const persistOtpProgress = (payload: OtpProgressState) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(OTP_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
  };

  const pushToast = (type: ToastType, message: string) => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev, { id, type, message: text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== id));
    }, 4200);
  };

  const mapServerError = (value: unknown, fallback: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const normalized = raw.toLowerCase();
    if (
      normalized.includes('tenant_name must match redirect_uri host tenant') ||
      normalized.includes('tenant callback is not mapped to this oauth client') ||
      normalized.includes('tenant callback host is not whitelisted') ||
      normalized.includes('tenant is not mapped to this oauth client') ||
      normalized.includes('tenant is not whitelisted for sso') ||
      normalized.includes('tenant configuration mismatch')
    ) {
      return copy.tenantMismatch;
    }
    return raw;
  };

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

  const clearOtpDigits = (context: OtpContext) => {
    const empty = Array(6).fill('');
    if (context === 'signin') setSigninOtpDigits(empty);
    else setSignupOtpDigits(empty);
  };

  const otpCodeFor = (context: OtpContext): string =>
    (context === 'signin' ? signinOtpDigits : signupOtpDigits).join('');

  const refsFor = (context: OtpContext): MutableRefObject<Array<HTMLInputElement | null>> =>
    context === 'signin' ? signinOtpRefs : signupOtpRefs;

  const setDigitsFor = (context: OtpContext, next: string[]) => {
    if (context === 'signin') setSigninOtpDigits(next);
    else setSignupOtpDigits(next);
  };

  const handleOtpDigitChange = (context: OtpContext, index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const current = context === 'signin' ? signinOtpDigits : signupOtpDigits;
    const next = [...current];
    next[index] = digit;
    setDigitsFor(context, next);
    if (digit && index < 5) {
      refsFor(context).current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (context: OtpContext, index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      const current = context === 'signin' ? signinOtpDigits : signupOtpDigits;
      if (!current[index] && index > 0) {
        refsFor(context).current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      refsFor(context).current[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && index < 5) {
      refsFor(context).current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (context: OtpContext, event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    const next = Array(6)
      .fill('')
      .map((_, idx) => pasted[idx] || '');
    setDigitsFor(context, next);
    const targetIndex = Math.min(pasted.length, 5);
    refsFor(context).current[targetIndex]?.focus();
  };

  const renderOtpInputs = (context: OtpContext, baseId: string) => {
    const digits = context === 'signin' ? signinOtpDigits : signupOtpDigits;
    const refs = refsFor(context);
    return (
      <div className="flex items-center justify-center gap-2" dir="ltr" style={{ direction: 'ltr' }}>
        {digits.map((digit, index) => (
          <input
            key={`${baseId}-${index}`}
            id={`${baseId}-${index + 1}`}
            ref={(node) => {
              refs.current[index] = node;
            }}
            className="h-12 w-12 rounded-xl border border-[#DADCE0] bg-white text-center text-lg font-semibold text-[#202124] outline-none transition-all duration-200 focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20"
            type="text"
            inputMode="numeric"
            pattern="[0-9]"
            autoComplete="one-time-code"
            maxLength={1}
            dir="ltr"
            value={digit}
            onChange={(event) => handleOtpDigitChange(context, index, event.target.value)}
            onKeyDown={(event) => handleOtpKeyDown(context, index, event)}
            onPaste={(event) => handleOtpPaste(context, event)}
          />
        ))}
      </div>
    );
  };

  const renderPhoneInput = (fieldId: string) => (
    <div>
      <label className="mb-1 block text-sm font-normal text-[#202124]" htmlFor={fieldId}>
        {copy.phoneNumber}
      </label>
      <div
        className="relative flex w-full items-center rounded-2xl border border-[#D6DCE8] bg-white shadow-[0_8px_22px_-20px_rgba(26,115,232,0.85)] transition-all duration-200 focus-within:border-[#1A73E8] focus-within:ring-2 focus-within:ring-[#1A73E8]/20"
        dir="ltr"
      >
        <div
          ref={countryPickerRef}
          className="relative h-[48px] w-[76px] shrink-0 rounded-l-2xl border-r border-[#E6EBF2] bg-[#F7FAFF]"
        >
          <button
            type="button"
            className="flex h-full w-full items-center justify-center gap-1 rounded-l-2xl bg-transparent text-lg text-[#202124] outline-none transition-colors hover:bg-[#EEF3FD]"
            aria-label={copy.selectCountry}
            aria-expanded={countryPickerOpen}
            onClick={() => setCountryPickerOpen((prev) => !prev)}
          >
            <span>{selectedCountry.flag}</span>
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
                  onClick={() => handleCountryChange(country.code)}
                >
                  <span className="text-lg">{country.flag}</span>
                  <span className="truncate font-medium">{copy.countryNames[country.code] || country.name}</span>
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
          onChange={(event) => handlePhoneInputChange(event.target.value)}
          placeholder={countryPlaceholder(selectedCountry)}
          autoComplete="tel-national"
          required
        />
      </div>
    </div>
  );

  const authContextBody = useMemo(() => {
    const payload: Record<string, string> = { returnTo };
    if (clientId) payload.client_id = clientId;
    if (tenantName) payload.tenant_name = tenantName;
    if (tenantOrgRandId) payload.tenant_org_id = tenantOrgRandId;
    return payload;
  }, [clientId, returnTo, tenantName, tenantOrgRandId]);

  const postJson = async (url: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await parseJsonSafe(res);
    return { ok: res.ok, status: res.status, data };
  };

  const enterSigninPhoneStep = () => {
    setMode('signin');
    setSigninStep('phone');
    clearOtpDigits('signin');
    setPassword('');
    setOtpWaitUntilMs(0);
    clearOtpProgress();
  };

  const startOtpLogin = async (): Promise<boolean> => {
    const phone = fullPhoneNumber.trim();
    if (!phone) {
      pushToast('error', copy.phoneRequired);
      return false;
    }

    setBusyAction('signin-otp-send');
    try {
      const { ok, status, data } = await postJson('/auth/login/otp/start', {
        ...authContextBody,
        phone_number: phone,
        signin_step: 'otp',
      });

      if (!ok || (status !== 202 && status !== 200)) {
        pushToast('error', mapServerError(data.error, copy.failedSendCode));
        return false;
      }

      const resendAt = Date.parse(String(data.resendAvailableAt || ''));
      setOtpWaitUntilMs(Number.isFinite(resendAt) ? resendAt : 0);
      setSigninStep('otp');
      clearOtpDigits('signin');
      persistOtpProgress({
        mode: 'signin',
        step: 'otp',
        phoneNumber: phone,
        otpWaitUntilMs: Number.isFinite(resendAt) ? resendAt : 0,
        savedAt: Date.now(),
      });

      const debugCode = String(data.otpDebugCode || '').trim();
      pushToast(
        'success',
        debugCode ? copy.codeSentDev.replace('{code}', debugCode) : copy.codeSent,
      );
      return true;
    } catch {
      pushToast('error', copy.failedSendCode);
      return false;
    } finally {
      setBusyAction('');
    }
  };

  const handleSigninPhoneContinue = async (event: FormEvent) => {
    event.preventDefault();
    const phone = fullPhoneNumber.trim();
    if (!phone) {
      pushToast('error', copy.phoneRequired);
      return;
    }

    setBusyAction('signin-phone-continue');
    try {
      const res = await fetch(`/api/public/login-options?phone_number=${encodeURIComponent(phone)}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await parseJsonSafe(res);

      if (!res.ok) {
        if (res.status === 404) {
          pushToast('error', copy.accountNotFound);
          return;
        }
        pushToast('error', mapServerError(data.error, copy.unableResolveLoginOptions));
        return;
      }

      const passwordEnabled = Boolean((data.methods as { password?: boolean } | undefined)?.password);
      if (passwordEnabled) {
        setSigninStep('password');
        clearOtpProgress();
        return;
      }

      await startOtpLogin();
    } catch {
      pushToast('error', copy.unableContinueLogin);
    } finally {
      setBusyAction('');
    }
  };

  const handleSigninPasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const phone = fullPhoneNumber.trim();
    const pwd = password;
    if (!phone) {
      pushToast('error', copy.phoneRequired);
      return;
    }
    if (!pwd) {
      pushToast('error', copy.passwordRequired);
      return;
    }

    setBusyAction('signin-password-submit');
    try {
      const { ok, status, data } = await postJson('/auth/login', {
        ...authContextBody,
        phone_number: phone,
        password: pwd,
      });

      if (ok && status === 200) {
        clearOtpProgress();
        window.location.href = String(data.returnTo || returnTo);
        return;
      }

      if (status === 202 || data.requiresTwoFactor === true) {
        setSigninStep('twofactor');
        clearOtpDigits('signin');
        persistOtpProgress({
          mode: 'signin',
          step: 'twofactor',
          phoneNumber: phone,
          otpWaitUntilMs: 0,
          savedAt: Date.now(),
        });
        pushToast('success', String(data.message || copy.twoFactorPromptToast));
        return;
      }

      pushToast('error', mapServerError(data.error, copy.invalidCredentials));
    } catch {
      pushToast('error', copy.loginFailed);
    } finally {
      setBusyAction('');
    }
  };

  const handleSigninOtpVerify = async (event: FormEvent) => {
    event.preventDefault();
    const phone = fullPhoneNumber.trim();
    const code = otpCodeFor('signin').trim();
    if (!phone) {
      pushToast('error', copy.phoneRequired);
      return;
    }
    if (!code) {
      pushToast('error', copy.codeRequired);
      return;
    }
    if (code.length !== 6) {
      pushToast('error', copy.codeLength);
      return;
    }

    const endpoint = '/auth/login/otp/complete';

    setBusyAction('signin-otp-verify');
    try {
      const { ok, status, data } = await postJson(endpoint, {
        ...authContextBody,
        phone_number: phone,
        otp_code: code,
      });

      if (status === 202 || data.requiresTwoFactor === true) {
        setSigninStep('twofactor');
        clearOtpDigits('signin');
        persistOtpProgress({
          mode: 'signin',
          step: 'twofactor',
          phoneNumber: phone,
          otpWaitUntilMs: 0,
          savedAt: Date.now(),
        });
        pushToast('success', String(data.message || copy.twoFactorPromptToast));
        return;
      }

      if (!ok) {
        pushToast('error', mapServerError(data.error, copy.codeCheckFailed));
        return;
      }

      clearOtpProgress();
      window.location.href = String(data.returnTo || returnTo);
    } catch {
      pushToast('error', copy.codeCheckFailed);
    } finally {
      setBusyAction('');
    }
  };

  const handleSigninTwoFactorVerify = async (event: FormEvent) => {
    event.preventDefault();
    const code = otpCodeFor('signin').trim();
    if (!code) {
      pushToast('error', copy.codeRequired);
      return;
    }
    if (code.length !== 6) {
      pushToast('error', copy.codeLength);
      return;
    }

    setBusyAction('signin-2fa-verify');
    try {
      const { ok, data } = await postJson('/auth/login/two-factor/complete', {
        ...authContextBody,
        verification_code: code,
      });

      if (!ok) {
        pushToast('error', mapServerError(data.error, copy.twoFactorFailed));
        return;
      }

      clearOtpProgress();
      window.location.href = String(data.returnTo || returnTo);
    } catch {
      pushToast('error', copy.twoFactorFailed);
    } finally {
      setBusyAction('');
    }
  };

  const handleSignupPhoneSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await requestSignupOtp();
  };

  const requestSignupOtp = async (): Promise<void> => {
    const phone = fullPhoneNumber.trim();
    if (!phone) {
      pushToast('error', copy.phoneRequired);
      return;
    }
    if (!allowRegistration) {
      pushToast('error', copy.registrationDisabledTenant);
      return;
    }

    setBusyAction('signup-otp-send');
    try {
      const { ok, status, data } = await postJson('/auth/register/start', {
        ...authContextBody,
        phone_number: phone,
        signup_step: 'verify',
      });

      if (!ok || (status !== 202 && status !== 200)) {
        pushToast('error', mapServerError(data.error, copy.failedSendCode));
        return;
      }

      const resendAt = Date.parse(String(data.resendAvailableAt || ''));
      setOtpWaitUntilMs(Number.isFinite(resendAt) ? resendAt : 0);
      setSignupStep('otp');
      clearOtpDigits('signup');
      persistOtpProgress({
        mode: 'signup',
        step: 'otp',
        phoneNumber: phone,
        otpWaitUntilMs: Number.isFinite(resendAt) ? resendAt : 0,
        savedAt: Date.now(),
      });
      const debugCode = String(data.otpDebugCode || '').trim();
      pushToast(
        'success',
        debugCode ? copy.codeSentDev.replace('{code}', debugCode) : copy.codeSent,
      );
    } catch {
      pushToast('error', copy.failedSendCode);
    } finally {
      setBusyAction('');
    }
  };

  const handleSignupOtpVerify = async (event: FormEvent) => {
    event.preventDefault();
    const phone = fullPhoneNumber.trim();
    const code = otpCodeFor('signup').trim();
    if (!phone) {
      pushToast('error', copy.phoneRequired);
      return;
    }
    if (!code) {
      pushToast('error', copy.codeRequired);
      return;
    }
    if (code.length !== 6) {
      pushToast('error', copy.codeLength);
      return;
    }

    setBusyAction('signup-otp-verify');
    try {
      const { ok, data } = await postJson('/auth/register/complete', {
        ...authContextBody,
        phone_number: phone,
        otp_code: code,
      });

      if (!ok) {
        pushToast('error', mapServerError(data.error, copy.signUpFailed));
        return;
      }

      clearOtpProgress();
      window.location.href = String(data.returnTo || returnTo);
    } catch {
      pushToast('error', copy.signUpFailed);
    } finally {
      setBusyAction('');
    }
  };

  useEffect(() => {
    const requestedMode = one(router.query.mode).toLowerCase();
    if (requestedMode === 'signup') {
      setMode('signup');
      setSignupStep('phone');
      return;
    }
    setMode('signin');
  }, [router.query.mode]);

  useEffect(() => {
    if (!clientId) {
      setAllowRegistration(true);
      return;
    }

    const loadPolicy = async () => {
      try {
        let url = `/api/public/register-policy?client_id=${encodeURIComponent(clientId)}`;
        if (tenantName) url += `&tenant_name=${encodeURIComponent(tenantName)}`;
        const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        const data = await parseJsonSafe(res);
        const allowed = Boolean(data.allowRegistration);
        setAllowRegistration(allowed);
        if (!allowed) pushToast('error', copy.registrationDisabledTenant);
      } catch {
        setAllowRegistration(false);
        pushToast('error', copy.registrationPolicyFailed);
      }
    };

    void loadPolicy();
  }, [clientId, tenantName, copy.registrationDisabledTenant, copy.registrationPolicyFailed]);

  useEffect(() => {
    if (!router.isReady) return;
    const fallbackPhone = one(router.query.phone_number);
    if (fallbackPhone) applyPhoneValue(fallbackPhone);

    const loadUiState = async () => {
      try {
        const res = await fetch('/api/public/login-ui-state', { credentials: 'include' });
        if (!res.ok) return;
        const data = await parseJsonSafe(res);
        const state = (data.state || {}) as Record<string, unknown>;

        const nextMode = one(state.mode as string | string[] | undefined).toLowerCase();
        if (nextMode === 'signin' || nextMode === 'signup') setMode(nextMode as Mode);

        const nextSigninStep = one(state.signinStep as string | string[] | undefined).toLowerCase();
        if (nextSigninStep === 'password' || nextSigninStep === 'otp' || nextSigninStep === 'twofactor') {
          setSigninStep(nextSigninStep as SigninStep);
        } else {
          setSigninStep('phone');
        }

        const nextSignupStep = one(state.signupStep as string | string[] | undefined).toLowerCase();
        if (nextSignupStep === 'verify' || nextSignupStep === 'otp') setSignupStep('otp');
        if (nextSignupStep === 'start' || nextSignupStep === 'phone') setSignupStep('phone');

        const statePhone = one(state.phoneNumber as string | string[] | undefined);
        if (statePhone) applyPhoneValue(statePhone);

        const require2fa = Boolean(state.require2fa);
        if (require2fa) {
          setSigninStep('twofactor');
        }

        const waitMs = Number(state.otpWaitUntilMs || 0);
        if (Number.isFinite(waitMs) && waitMs > 0) setOtpWaitUntilMs(waitMs);

        const hasServerOtpState =
          nextSigninStep === 'otp' ||
          nextSigninStep === 'twofactor' ||
          nextSignupStep === 'verify' ||
          nextSignupStep === 'otp' ||
          require2fa ||
          (Number.isFinite(waitMs) && waitMs > 0) ||
          Boolean(statePhone);

        if (!hasServerOtpState && typeof window !== 'undefined') {
          const raw = window.localStorage.getItem(OTP_PROGRESS_STORAGE_KEY);
          if (raw) {
            try {
              const persisted = JSON.parse(raw) as Partial<OtpProgressState>;
              const persistedPhone = String(persisted.phoneNumber || '').trim();
              const persistedMode = String(persisted.mode || '').toLowerCase();
              const persistedWait = Number(persisted.otpWaitUntilMs || 0);
              const persistedSavedAt = Number(persisted.savedAt || 0);
              const ageMs = persistedSavedAt > 0 ? Date.now() - persistedSavedAt : 0;
              const isFresh = ageMs <= 30 * 60 * 1000;

              if (persistedPhone && isFresh) {
                applyPhoneValue(persistedPhone);
                if (Number.isFinite(persistedWait) && persistedWait > 0) setOtpWaitUntilMs(persistedWait);
                if (persistedMode === 'signup') {
                  setMode('signup');
                  setSignupStep('otp');
                } else {
                  setMode('signin');
                  setSigninStep(persisted.step === 'twofactor' ? 'twofactor' : 'otp');
                }
              } else {
                clearOtpProgress();
              }
            } catch {
              clearOtpProgress();
            }
          }
        }

        const error = one(state.error as string | string[] | undefined);
        const success = one(state.success as string | string[] | undefined);
        if (error) pushToast('error', mapServerError(error, error));
        if (success) pushToast('success', success);
      } catch {
        // ignore
      }
    };

    void loadUiState();
  }, [router.isReady, router.query.phone_number]);

  useEffect(() => {
    if (!otpWaitUntilMs || otpWaitUntilMs <= 0) {
      setResendRemainingSec(0);
      return;
    }
    const update = () => {
      const remainingMs = otpWaitUntilMs - Date.now();
      setResendRemainingSec(remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [otpWaitUntilMs]);

  return (
    <>
      <Head>
        <title>{copy.headTitle}</title>
      </Head>

      <main className="auth-login-page relative min-h-[100dvh] overflow-x-hidden bg-[#F6F8FC] text-[#202124]" dir={localeDir(locale)}>
        <div className="pointer-events-none absolute bottom-8 left-8 z-0 login-bg-logo opacity-[0.08]">
          <Image src="/images/lm_dark.png" alt="" width={180} height={180} priority className="h-[130px] w-auto md:h-[160px]" />
        </div>

        <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[calc(100vw-2rem)] max-w-[380px] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
                toast.type === 'success'
                  ? 'border-[#81C995] bg-[#E6F4EA] text-[#137333]'
                  : 'border-[#F28B82] bg-[#FDECEA] text-[#B3261E]'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1400px] items-end justify-center px-4 pb-10 pt-4 sm:px-6 sm:pt-6 md:items-center md:pb-0">
          <section className="w-full max-w-[520px] login-shell-enter">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5F6368]">{mode === 'signup' ? copy.signUp : copy.signIn}</p>
              <h1 className="mt-1 text-[28px] font-normal text-[#202124]">
                {mode === 'signup' ? copy.createAccount : loginTitle}
              </h1>
              <p className="mt-2 text-sm text-[#5F6368]">
                {mode === 'signup'
                  ? copy.startWithPhone
                  : copy.welcomeBack}
              </p>
            </div>

            <div className="mt-6 flex justify-center">
              <div className="inline-flex items-center gap-1 rounded-full border border-[#DADCE0] bg-white p-1">
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      clearOtpProgress();
                      setMode('signin');
                      setSigninStep('phone');
                      clearOtpDigits('signin');
                    }}
                    className={`${tabBaseClass} ${
                      mode === 'signin'
                        ? 'bg-[#E8F0FE] text-[#1A73E8]'
                        : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
                    }`}
                  >
                    {copy.signIn}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearOtpProgress();
                      setMode('signup');
                      setSignupStep('phone');
                      clearOtpDigits('signup');
                    }}
                    className={`${tabBaseClass} ${
                      mode === 'signup'
                        ? 'bg-[#E8F0FE] text-[#1A73E8]'
                        : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
                    }`}
                  >
                    {copy.signUp}
                  </button>
                </div>
                <span className="mx-1 h-5 w-px bg-[#E8EAED]" aria-hidden />
                <LanguageToggle locale={locale} onChange={setLocale} variant="inline" />
              </div>
            </div>

            {tenantName ? (
              <div className="mt-2 flex justify-center">
                <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-3 py-1 text-xs font-medium text-[#1A73E8]">
                  {copy.tenant}: {tenantName}
                </span>
              </div>
            ) : null}

            <div className="mt-6 min-h-[340px]">
              {mode === 'signin' && signinStep === 'phone' ? (
                <form onSubmit={handleSigninPhoneContinue} className="mx-auto w-full max-w-[360px] space-y-4">
                  {renderPhoneInput('signin_phone')}
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="submit" className={primaryBtnClass} disabled={busyAction === 'signin-phone-continue'}>
                      {busyAction === 'signin-phone-continue' ? copy.checking : copy.continue}
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === 'signin' && signinStep === 'password' ? (
                <form onSubmit={handleSigninPasswordSubmit} className="mx-auto w-full max-w-[360px] space-y-4">
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="block text-sm font-normal text-[#202124]" htmlFor="signin_password">
                        {copy.password}
                      </label>
                      <button
                        type="button"
                        className={inlineLinkClass}
                        onClick={() => {
                          void startOtpLogin();
                        }}
                        disabled={busyAction === 'signin-otp-send'}
                      >
                        {busyAction === 'signin-otp-send' ? copy.sendingCode : copy.loginWithVerificationCode}
                      </button>
                    </div>
                    <input
                      id="signin_password"
                      className={`${inputClass} text-left`}
                      type="password"
                      dir="ltr"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="submit" className={primaryBtnClass} disabled={busyAction === 'signin-password-submit'}>
                      {busyAction === 'signin-password-submit' ? copy.signingIn : copy.signIn}
                    </button>
                    <button type="button" className={secondaryBtnClass} onClick={enterSigninPhoneStep}>
                      {copy.changePhone}
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === 'signin' && signinStep === 'otp' ? (
                <form onSubmit={handleSigninOtpVerify} className="mx-auto w-full max-w-[360px] space-y-4">
                  <div>{renderOtpInputs('signin', 'signin-otp')}</div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="submit" className={primaryBtnClass} disabled={busyAction === 'signin-otp-verify'}>
                      {busyAction === 'signin-otp-verify' ? copy.verifying : copy.verify}
                    </button>
                    <button
                      type="button"
                      className={secondaryBtnClass}
                      onClick={() => {
                        clearOtpProgress();
                        setSigninStep('phone');
                        clearOtpDigits('signin');
                      }}
                    >
                      {copy.back}
                    </button>
                  </div>
                  <div className="text-center">
                    <button
                      type="button"
                      className={tinyLinkClass}
                      disabled={resendRemainingSec > 0 || busyAction === 'signin-otp-send'}
                      onClick={() => {
                        void startOtpLogin();
                      }}
                    >
                      {resendRemainingSec > 0
                        ? copy.sendCodeAgainIn.replace('{time}', formatCountdown(resendRemainingSec))
                        : busyAction === 'signin-otp-send'
                          ? copy.sendingCode
                          : copy.sendCodeAgain}
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === 'signin' && signinStep === 'twofactor' ? (
                <form onSubmit={handleSigninTwoFactorVerify} className="mx-auto w-full max-w-[360px] space-y-4">
                  <p className="text-center text-sm text-[#5F6368]">{copy.authenticatorPrompt}</p>
                  <div>{renderOtpInputs('signin', 'signin-twofactor')}</div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="submit" className={primaryBtnClass} disabled={busyAction === 'signin-2fa-verify'}>
                      {busyAction === 'signin-2fa-verify' ? copy.verifying : copy.verify}
                    </button>
                    <button
                      type="button"
                      className={secondaryBtnClass}
                      onClick={() => {
                        clearOtpProgress();
                        setSigninStep('phone');
                        clearOtpDigits('signin');
                      }}
                    >
                      {copy.back}
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === 'signup' && signupStep === 'phone' ? (
                <form onSubmit={handleSignupPhoneSubmit} className="mx-auto w-full max-w-[360px] space-y-4">
                  <fieldset disabled={!allowRegistration}>{renderPhoneInput('signup_phone')}</fieldset>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="submit" className={primaryBtnClass} disabled={!allowRegistration || busyAction === 'signup-otp-send'}>
                      {busyAction === 'signup-otp-send' ? copy.sendingCode : copy.sendVerificationCode}
                    </button>
                  </div>
                </form>
              ) : null}

              {mode === 'signup' && signupStep === 'otp' ? (
                <form onSubmit={handleSignupOtpVerify} className="mx-auto w-full max-w-[360px] space-y-4">
                  <div>{renderOtpInputs('signup', 'signup-otp')}</div>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button type="submit" className={primaryBtnClass} disabled={busyAction === 'signup-otp-verify'}>
                      {busyAction === 'signup-otp-verify' ? copy.verifying : copy.completeSignUp}
                    </button>
                    <button
                      type="button"
                      className={secondaryBtnClass}
                      onClick={() => {
                        clearOtpProgress();
                        setSignupStep('phone');
                      }}
                    >
                      {copy.back}
                    </button>
                  </div>
                  <div className="text-center">
                    <button
                      type="button"
                      className={tinyLinkClass}
                      disabled={resendRemainingSec > 0 || busyAction === 'signup-otp-send'}
                      onClick={() => {
                        void requestSignupOtp();
                      }}
                    >
                      {resendRemainingSec > 0
                        ? copy.sendSmsAgainIn.replace('{time}', formatCountdown(resendRemainingSec))
                        : busyAction === 'signup-otp-send'
                          ? copy.sendingCode
                          : copy.sendSmsAgain}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>

            <p className="mt-6 text-center text-xs text-[#5F6368]">{branding.copyright}</p>
          </section>
        </div>
      </main>
    </>
  );
}
