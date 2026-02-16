import Head from 'next/head';
import Link from 'next/link';
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiCalendar,
  FiCamera,
  FiChevronLeft,
  FiChevronRight,
  FiDatabase,
  FiHome,
  FiKey,
  FiLogOut,
  FiMoreHorizontal,
  FiPhone,
  FiShield,
  FiUser,
} from 'react-icons/fi';
import { LanguageToggle } from '../components/ui/LanguageToggle';
import { localeDir, useUiLocale } from '../lib/ui/locale';
import { getAuthMessages } from '../lib/ui/i18n';

interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
    isAuthAdmin?: boolean;
  };
}

interface ProfilePayload {
  profile: {
    user: {
      randId: string;
      email: string;
      firstName: string;
      lastName: string;
      nationalId: string;
      phoneNumber: string;
      isPhoneVerified: boolean;
      registeredAt: string;
      isActive: boolean;
      avatarUrl: string | null;
      birthday: string | null;
      gender: string | null;
    };
    security: {
      hasPassword: boolean;
      twoFactorEnabled: boolean;
      twoFactorMethod: 'none' | 'app' | 'sms';
      twoFactorPhone: string | null;
      twoFactorAppConfigured: boolean;
      twoFactorSetupPending: boolean;
      updatedAt: string | null;
    };
    organizations: Array<{
      assignmentRandId: string;
      orgRandId: string;
      orgName: string;
      orgCode: string;
      assignedAt: string;
      isAssignmentActive: boolean;
    }>;
    roles: Array<{
      assignmentRandId: string;
      roleRandId: string;
      roleName: string;
      roleCode: string;
      orgRandId: string;
      orgName: string | null;
      assignedAt: string;
      isAssignmentActive: boolean;
    }>;
    audit: {
      lastLoginAt: string | null;
      lastLoginIp: string | null;
      lastLoginUserAgent: string | null;
      lastSeenAt: string | null;
    };
  };
}

type RailKey =
  | 'home'
  | 'personal-info'
  | 'contact-info'
  | 'data-privacy'
  | 'security'
  | 'two-factor';

const railItems: Array<{
  key: RailKey;
  icon: React.ComponentType<{ className?: string }>;
  sectionId: string;
}> = [
  { key: 'home', icon: FiHome, sectionId: 'section-hero' },
  { key: 'personal-info', icon: FiUser, sectionId: 'section-personal-info-form' },
  { key: 'contact-info', icon: FiPhone, sectionId: 'section-contact-info' },
  { key: 'data-privacy', icon: FiDatabase, sectionId: 'section-privacy' },
  { key: 'security', icon: FiShield, sectionId: 'section-security' },
  { key: 'two-factor', icon: FiKey, sectionId: 'section-two-factor' },
];

const mobilePrimaryKeys: RailKey[] = ['home', 'personal-info', 'security', 'two-factor'];
const mobileBeforeHomeKeys: RailKey[] = ['personal-info', 'security'];
const mobileAfterHomeKeys: RailKey[] = ['two-factor'];

const formatDateTime = (value: string | null | undefined, fallback = 'n/a'): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return fallback;
  return date.toLocaleString();
};

const BIRTHDAY_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthLabelFormatterFor = (calendarLocale: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(calendarLocale || 'en-US', { month: 'long', year: 'numeric' });

const calendarMonthOptionsFor = (calendarLocale: string): Array<{ value: number; label: string }> =>
  Array.from({ length: 12 }, (_, month) => ({
    value: month,
    label: new Intl.DateTimeFormat(calendarLocale || 'en-US', { month: 'long' }).format(new Date(2020, month, 1)),
  }));

const parseDateOnly = (value: string): Date | null => {
  const match = BIRTHDAY_INPUT_PATTERN.exec(value || '');
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (
    Number.isNaN(candidate.valueOf()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return candidate;
};

const toDateOnly = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const monthStart = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), 1);

const buildCalendarGrid = (month: Date): Array<Date | null> => {
  const start = monthStart(month);
  const offset = start.getDay();
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  for (let index = 0; index < offset; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(start.getFullYear(), start.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

const isSameDay = (left: Date | null, right: Date | null): boolean => {
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
};

const initialsFrom = (firstName: string, lastName: string): string => {
  const first = String(firstName || '').trim().charAt(0);
  const last = String(lastName || '').trim().charAt(0);
  const fallback = String(firstName || lastName || '').trim().charAt(0);
  return `${first}${last || fallback}`.toUpperCase() || 'U';
};

const cardClass =
  'rounded-[24px] p-6';

const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition-all duration-200 focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20';

const primaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#1765cc] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';

const secondaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#F6F9FE] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';
const desktopRailLeft = 'max(0.75rem, calc((100vw - 1400px) / 2 + 0.75rem))';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

const infoRow = (label: string, value: string, onClick?: () => void, isRtl = false) => (
  <button
    type="button"
    onClick={onClick}
    className={`group flex w-full items-center justify-between gap-3 px-1 py-3 transition-all duration-200 hover:bg-[#F8F9FA] ${isRtl ? 'text-right' : 'text-left'}`}
  >
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#5F6368]">{label}</p>
      <p className="mt-1 text-sm text-[#202124]">{value}</p>
    </div>
    <FiChevronRight className="h-4 w-4 text-[#5F6368] transition-transform duration-200 group-hover:translate-x-0.5" />
  </button>
);

type ToastType = 'success' | 'error';

interface ToastEntry {
  id: number;
  type: ToastType;
  message: string;
}

export default function ProfilePage() {
  const { locale, isRtl, setLocale } = useUiLocale();
  const copy = getAuthMessages(locale).profile;
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [profile, setProfile] = useState<ProfilePayload['profile'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const toastIdRef = useRef(1);

  const [detailsSaving, setDetailsSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [twoFaSaving, setTwoFaSaving] = useState(false);

  const [activeRail, setActiveRail] = useState<RailKey>('home');

  const [detailsForm, setDetailsForm] = useState({
    firstName: '',
    lastName: '',
    nationalId: '',
    phoneNumber: '',
    avatarUrl: '',
    birthday: '',
    gender: '',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [twoFaQrDataUrl, setTwoFaQrDataUrl] = useState('');
  const [twoFaQrLoading, setTwoFaQrLoading] = useState(false);
  const [twoFaQrError, setTwoFaQrError] = useState('');
  const [birthdayPickerOpen, setBirthdayPickerOpen] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState<Date>(() => monthStart(new Date()));
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const birthdayPickerRef = useRef<HTMLDivElement | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const csrfToken = session?.csrfToken || '';

  const pushToast = (type: ToastType, message: string) => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev, { id, type, message: text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((entry) => entry.id !== id));
    }, 4200);
  };

  const applyProfileState = (next: ProfilePayload['profile']) => {
    setProfile(next);
    setDetailsForm({
      firstName: next.user.firstName || '',
      lastName: next.user.lastName || '',
      nationalId: next.user.nationalId || '',
      phoneNumber: next.user.phoneNumber || '',
      avatarUrl: next.user.avatarUrl || '',
      birthday: next.user.birthday || '',
      gender: next.user.gender || '',
    });
    if (next.security.twoFactorEnabled) {
      setTwoFaSetup(null);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const sessionRes = await fetch('/api/session', { credentials: 'include' });
      const sessionData = (await sessionRes.json()) as SessionPayload;
      setSession(sessionData);

      if (!sessionData.authenticated) {
        pushToast('error', copy.toasts.sessionExpired);
        setProfile(null);
        return;
      }

      const profileRes = await fetch('/api/profile', { credentials: 'include' });
      const profileData = (await profileRes.json()) as ProfilePayload & { error?: string };
      if (!profileRes.ok) {
        throw new Error(profileData.error || copy.errors.loadProfileFailed);
      }

      applyProfileState(profileData.profile);
    } catch (loadError) {
      pushToast('error', loadError instanceof Error ? loadError.message : copy.errors.loadProfileFailed);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!twoFaSetup?.otpauthUri) {
      setTwoFaQrDataUrl('');
      setTwoFaQrError('');
      setTwoFaQrLoading(false);
      return;
    }

    let cancelled = false;
    setTwoFaQrLoading(true);
    setTwoFaQrError('');

    void import('qrcode')
      .then((module) =>
        module.toDataURL(twoFaSetup.otpauthUri, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 240,
          color: {
            dark: '#202124',
            light: '#FFFFFF',
          },
        }),
      )
      .then((url) => {
        if (cancelled) return;
        setTwoFaQrDataUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setTwoFaQrDataUrl('');
        setTwoFaQrError(copy.errors.twoFactorQrUnavailable);
      })
      .finally(() => {
        if (cancelled) return;
        setTwoFaQrLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [twoFaSetup?.otpauthUri, copy.errors.twoFactorQrUnavailable]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (mobileMenuRef.current && target && !mobileMenuRef.current.contains(target)) {
        setMobileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!birthdayPickerOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (birthdayPickerRef.current && target && !birthdayPickerRef.current.contains(target)) {
        setBirthdayPickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBirthdayPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [birthdayPickerOpen]);

  const avatarInitials = useMemo(() => {
    if (!profile) return 'U';
    return initialsFrom(profile.user.firstName, profile.user.lastName);
  }, [profile]);

  const mobileBeforeHomeItems = useMemo(
    () => railItems.filter((item) => mobileBeforeHomeKeys.includes(item.key)),
    [],
  );

  const mobileAfterHomeItems = useMemo(
    () => railItems.filter((item) => mobileAfterHomeKeys.includes(item.key)),
    [],
  );

  const mobileHomeItem = useMemo(
    () => railItems.find((item) => item.key === 'home') || null,
    [],
  );

  const mobileOverflowItems = useMemo(
    () => railItems.filter((item) => !mobilePrimaryKeys.includes(item.key)),
    [],
  );

  const mobileMoreActive = useMemo(
    () => mobileOverflowItems.some((item) => item.key === activeRail),
    [activeRail, mobileOverflowItems],
  );
  const toggleCornerClass = isRtl ? 'left-4' : 'right-4';

  const railLabels: Record<RailKey, string> = useMemo(
    () => ({
      home: copy.nav.home,
      'personal-info': copy.nav.personalInfo,
      'contact-info': copy.nav.contactInfo,
      'data-privacy': copy.nav.dataPrivacy,
      security: copy.nav.security,
      'two-factor': copy.nav.twoFactor,
    }),
    [copy],
  );

  const profileAvatar = detailsForm.avatarUrl || profile?.user.avatarUrl || '';
  const calendarWeekdays = copy.calendarWeekdays;
  const monthLabelFormatter = useMemo(() => monthLabelFormatterFor(copy.calendarLocale), [copy.calendarLocale]);
  const calendarMonthOptions = useMemo(() => calendarMonthOptionsFor(copy.calendarLocale), [copy.calendarLocale]);
  const selectedBirthday = useMemo(() => parseDateOnly(detailsForm.birthday), [detailsForm.birthday]);
  const birthdayCells = useMemo(() => buildCalendarGrid(birthdayMonth), [birthdayMonth]);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const birthdayYearOptions = useMemo(() => {
    const currentYear = today.getFullYear();
    const startYear = 1900;
    const years: number[] = [];
    for (let year = currentYear; year >= startYear; year -= 1) {
      years.push(year);
    }
    return years;
  }, [today]);
  const birthdayDisplay = selectedBirthday
    ? new Intl.DateTimeFormat(copy.calendarLocale || 'en-US').format(selectedBirthday)
    : copy.birthdayPlaceholder;

  const handleSectionNav = (key: RailKey, sectionId: string) => {
    setActiveRail(key);
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => {
      const node = document.getElementById(sectionId);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const handleAvatarFabClick = () => {
    avatarFileInputRef.current?.click();
  };

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!csrfToken) {
      pushToast('error', copy.toasts.sessionExpired);
      return;
    }

    if (!AVATAR_ALLOWED_TYPES.has(file.type.toLowerCase())) {
      pushToast('error', copy.errors.avatarFileType);
      return;
    }

    if (file.size > AVATAR_MAX_BYTES) {
      pushToast('error', copy.errors.avatarFileSize);
      return;
    }

    try {
      const uploadRes = await fetch('/api/profile/avatar/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type,
          'X-CSRF-Token': csrfToken,
        },
        body: file,
      });
      const uploadData = (await uploadRes.json()) as { ok?: boolean; avatarUrl?: string; error?: string };
      if (!uploadRes.ok || !uploadData.avatarUrl) {
        throw new Error(uploadData.error || copy.errors.avatarLoadFailed);
      }

      setDetailsForm((prev) => ({ ...prev, avatarUrl: uploadData.avatarUrl || '' }));
      pushToast('success', copy.toasts.avatarSelected);
    } catch (uploadError) {
      pushToast('error', uploadError instanceof Error ? uploadError.message : copy.errors.avatarLoadFailed);
    }
  };

  const openBirthdayPicker = () => {
    setBirthdayMonth(monthStart(selectedBirthday || new Date()));
    setBirthdayPickerOpen(true);
  };

  const changeBirthdayMonth = (delta: number) => {
    setBirthdayMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const setBirthdayMonthValue = (month: number) => {
    setBirthdayMonth((prev) => new Date(prev.getFullYear(), month, 1));
  };

  const setBirthdayYearValue = (year: number) => {
    setBirthdayMonth((prev) => new Date(year, prev.getMonth(), 1));
  };

  const selectBirthday = (value: Date) => {
    const normalized = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (normalized.getTime() > today.getTime()) return;
    setDetailsForm((prev) => ({ ...prev, birthday: toDateOnly(normalized) }));
    setBirthdayPickerOpen(false);
  };

  const logout = async () => {
    if (!csrfToken) return;
    setMobileMenuOpen(false);
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });
    window.location.href = '/login';
  };

  const handleSaveDetails = async (event: FormEvent) => {
    event.preventDefault();
    if (!csrfToken) return;

    const firstName = detailsForm.firstName.trim();
    const lastName = detailsForm.lastName.trim();
    const nationalId = detailsForm.nationalId.trim();
    const phoneNumber = detailsForm.phoneNumber.trim();

    if (!firstName || !lastName || !nationalId) {
      pushToast('error', copy.toasts.requiredProfileFields);
      return;
    }

    if (!phoneNumber) {
      pushToast('error', copy.toasts.requiredPhone);
      return;
    }

    setDetailsSaving(true);
    try {
      const res = await fetch('/api/profile/details', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          firstName,
          lastName,
          nationalId,
          phoneNumber,
          avatarUrl: detailsForm.avatarUrl,
          birthday: detailsForm.birthday,
          gender: detailsForm.gender,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; profile?: ProfilePayload['profile']; error?: string };
      if (!res.ok) throw new Error(data.error || copy.errors.updateProfileFailed);
      if (data.profile) applyProfileState(data.profile);
      pushToast('success', copy.toasts.profileUpdated);
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : copy.errors.updateProfileFailed);
    } finally {
      setDetailsSaving(false);
    }
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!csrfToken) return;

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      pushToast('error', copy.toasts.passwordMismatch);
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(passwordForm),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || copy.errors.changePasswordFailed);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              security: {
                ...prev.security,
                hasPassword: true,
              },
            }
          : prev,
      );
      pushToast('success', copy.toasts.passwordUpdated);
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : copy.errors.changePasswordFailed);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleGenerateTwoFactorSetup = async () => {
    if (!csrfToken) return;
    setTwoFaSaving(true);
    try {
      const res = await fetch('/api/profile/2fa/setup', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        setup?: { secret: string; otpauthUri: string };
        error?: string;
      };
      if (!res.ok || !data.setup) throw new Error(data.error || copy.errors.prepareTwoFactorFailed);
      setTwoFaSetup(data.setup);
      setTwoFaCode('');
      pushToast('success', copy.toasts.twoFactorSetupGenerated);
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : copy.errors.prepareTwoFactorFailed);
    } finally {
      setTwoFaSaving(false);
    }
  };

  const handleEnableTwoFactor = async (event: FormEvent) => {
    event.preventDefault();
    if (!csrfToken) return;
    setTwoFaSaving(true);
    try {
      const res = await fetch('/api/profile/2fa/enable', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ verificationCode: twoFaCode }),
      });
      const data = (await res.json()) as { ok?: boolean; security?: ProfilePayload['profile']['security']; error?: string };
      if (!res.ok || !data.security) throw new Error(data.error || copy.errors.enableTwoFactorFailed);
      if (profile) {
        applyProfileState({ ...profile, security: data.security });
      }
      setTwoFaCode('');
      setTwoFaSetup(null);
      pushToast('success', copy.toasts.twoFactorEnabled);
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : copy.errors.enableTwoFactorFailed);
    } finally {
      setTwoFaSaving(false);
    }
  };

  const handleDisableTwoFactor = async () => {
    if (!csrfToken) return;
    setTwoFaSaving(true);
    try {
      const res = await fetch('/api/profile/2fa/disable', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      });
      const data = (await res.json()) as { ok?: boolean; security?: ProfilePayload['profile']['security']; error?: string };
      if (!res.ok || !data.security) throw new Error(data.error || copy.errors.disableTwoFactorFailed);
      if (profile) {
        applyProfileState({ ...profile, security: data.security });
      }
      setTwoFaCode('');
      setTwoFaSetup(null);
      pushToast('success', copy.toasts.twoFactorDisabled);
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : copy.errors.disableTwoFactorFailed);
    } finally {
      setTwoFaSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>{copy.title}</title>
      </Head>

      <main className="min-h-screen overflow-x-hidden bg-[#F6F8FC] pb-20 pt-6 text-[#202124] md:pb-8" dir={localeDir(locale)}>
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

        <div className={`fixed top-4 z-[60] ${toggleCornerClass}`}>
          <LanguageToggle locale={locale} onChange={setLocale} />
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-[1400px] items-stretch gap-6 px-3 sm:px-4">
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
                      onClick={() => handleSectionNav(item.key, item.sectionId)}
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
                    onClick={logout}
                    className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] ${isRtl ? 'text-right' : 'text-left'}`}
                  >
                    <FiLogOut className="h-6 w-6" />
                    <span>{copy.nav.logout}</span>
                  </button>
                </li>
              </ul>
            </nav>
          </aside>

          <section className="min-w-0 flex w-full max-w-full flex-1 flex-col justify-center gap-6">
            {loading ? <div className={`${cardClass} text-sm text-[#5F6368]`}>{copy.loadingProfile}</div> : null}
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              onChange={handleAvatarFileChange}
            />

            <div className="flex w-full flex-1 items-center justify-center">
              {session?.authenticated && session.user && profile ? (
                <>
                {activeRail === 'home' ? (
                  <section id="section-hero" className={`${cardClass} w-full px-6 py-10 text-center sm:w-[75%]`}>
                    <div className="relative mx-auto h-[120px] w-[120px]">
                      <div className="flex h-[120px] w-[120px] items-center justify-center overflow-hidden rounded-full border border-[#DADCE0] bg-[#F1F3F4] text-3xl font-normal text-[#1A73E8]">
                        {profileAvatar ? (
                          <img src={profileAvatar} alt={copy.profileAvatar} className="h-full w-full object-cover" />
                        ) : (
                          avatarInitials
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleAvatarFabClick}
                        className="absolute bottom-1 right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#DADCE0] bg-white text-[#1A73E8] shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)] transition-all duration-200 hover:bg-[#E8F0FE] active:brightness-95"
                        aria-label={copy.changeAvatarAria}
                      >
                        <FiCamera className="h-4 w-4" />
                      </button>
                    </div>

                    <h1 className="mt-5 text-[28px] font-normal text-[#202124]">
                      {copy.welcome}، {profile.user.firstName}
                    </h1>
                    <p className="mx-auto mt-2 max-w-3xl text-sm font-normal text-[#5F6368]">
                      {copy.welcomeSubtitle}
                    </p>

                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-[#5F6368]">
                      <span className="rounded-full bg-[#F1F3F4] px-3 py-1">
                        {copy.lastLogin}: {formatDateTime(profile.audit.lastLoginAt, copy.notSet)}
                      </span>
                      <span className="rounded-full bg-[#F1F3F4] px-3 py-1">
                        {copy.lastSeen}: {formatDateTime(profile.audit.lastSeenAt, copy.notSet)}
                      </span>
                      <span className="max-w-full break-all rounded-full bg-[#F1F3F4] px-3 py-1">
                        {profile.user.email}
                      </span>
                    </div>

                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                      {session.user.isAuthAdmin ? (
                        <Link href="/admin" className={secondaryBtnClass}>
                          {copy.openAuthAdmin}
                        </Link>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {activeRail === 'contact-info' ? (
                  <section id="section-contact-info" className="grid w-full grid-cols-1 gap-6 sm:w-[75%]">
                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.contactInfo}</h2>
                      <div className="mt-4 divide-y divide-[#E8EAED]">
                        {infoRow(copy.primaryEmail, profile.user.email || copy.notSet, undefined, isRtl)}
                        {infoRow(copy.recoveryEmail, copy.notSet, undefined, isRtl)}
                        {infoRow(copy.phoneNumber, profile.user.phoneNumber || copy.notSet, undefined, isRtl)}
                      </div>
                    </article>
                  </section>
                ) : null}

                {activeRail === 'data-privacy' ? (
                  <section id="section-privacy" className={`${cardClass} w-full sm:w-[75%]`}>
                    <div className="flex flex-col gap-4 rounded-[20px] border border-[#D2E3FC] bg-[#E8F0FE] p-5 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-2">
                        <h3 className="text-lg font-normal text-[#202124]">{copy.privacyCheckup}</h3>
                        <p className="text-sm font-normal text-[#5F6368]">
                          {copy.privacyCheckupHelp}
                        </p>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1A73E8] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#DBE8FD] active:brightness-95"
                        >
                          {copy.takeCheckup}
                        </button>
                      </div>
                      <div className="relative h-24 w-full overflow-hidden rounded-2xl bg-white/70 md:w-56">
                        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#1A73E8]/20" />
                        <div className="absolute right-8 top-10 h-12 w-12 rounded-full bg-[#34A853]/20" />
                        <div className="absolute left-6 bottom-2 h-10 w-10 rounded-full bg-[#FBBC04]/30" />
                      </div>
                    </div>
                  </section>
                ) : null}

                {activeRail === 'security' ? (
                  <section id="section-security" className="grid w-full grid-cols-1 gap-6 sm:w-[75%] xl:grid-cols-2">
                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.passwordSettings}</h2>
                      <form className="mt-4 space-y-4" onSubmit={handleChangePassword}>
                        {profile.security.hasPassword ? (
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.currentPassword}</label>
                            <input
                              type="password"
                              className={`${inputClass} text-left`}
                              dir="ltr"
                              value={passwordForm.currentPassword}
                              onChange={(event) =>
                                setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))
                              }
                              autoComplete="current-password"
                              required
                            />
                          </div>
                        ) : null}
                        <div>
                          <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.newPassword}</label>
                          <input
                            type="password"
                            className={`${inputClass} text-left`}
                            dir="ltr"
                            value={passwordForm.newPassword}
                            onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                            autoComplete="new-password"
                            minLength={10}
                            required
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.confirmNewPassword}</label>
                          <input
                            type="password"
                            className={`${inputClass} text-left`}
                            dir="ltr"
                            value={passwordForm.confirmPassword}
                            onChange={(event) =>
                              setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
                            }
                            autoComplete="new-password"
                            minLength={10}
                            required
                          />
                        </div>

                        <button type="submit" className={primaryBtnClass} disabled={passwordSaving}>
                          {passwordSaving ? copy.updating : profile.security.hasPassword ? copy.updatePassword : copy.setPassword}
                        </button>
                      </form>
                    </article>

                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.lastLoginSession}</h2>
                      <div className="mt-4 space-y-3 text-sm text-[#5F6368]">
                        <p>
                          <span className="font-normal text-[#202124]">{copy.lastLogin}:</span>{' '}
                          {formatDateTime(profile.audit.lastLoginAt, copy.notSet)}
                        </p>
                        <p>
                          <span className="font-normal text-[#202124]">{copy.ipAddress}:</span>{' '}
                          {profile.audit.lastLoginIp || copy.notSet}
                        </p>
                        <p>
                          <span className="font-normal text-[#202124]">{copy.userAgent}:</span>{' '}
                          {profile.audit.lastLoginUserAgent || copy.notSet}
                        </p>
                        <p>
                          <span className="font-normal text-[#202124]">{copy.lastSeen}:</span>{' '}
                          {formatDateTime(profile.audit.lastSeenAt, copy.notSet)}
                        </p>
                      </div>
                    </article>
                  </section>
                ) : null}

                {activeRail === 'personal-info' ? (
                  <section id="section-personal-info-form" className="grid w-full grid-cols-1 gap-6 sm:w-[75%] xl:grid-cols-2">
                    <article id="section-settings" className={`${cardClass} xl:col-span-2`}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.personalInfo}</h2>
                      <form className="mt-4 space-y-4" onSubmit={handleSaveDetails}>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.firstName}</label>
                            <input
                              className={inputClass}
                              value={detailsForm.firstName}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, firstName: event.target.value }))}
                              placeholder={copy.placeholders.firstName}
                              maxLength={120}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.lastName}</label>
                            <input
                              className={inputClass}
                              value={detailsForm.lastName}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, lastName: event.target.value }))}
                              placeholder={copy.placeholders.lastName}
                              maxLength={120}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.birthday}</label>
                            <div ref={birthdayPickerRef} className="relative">
                              <button
                                type="button"
                                className={`${inputClass} flex items-center justify-between ${isRtl ? 'text-right' : 'text-left'}`}
                                onClick={() => (birthdayPickerOpen ? setBirthdayPickerOpen(false) : openBirthdayPicker())}
                              >
                                <span className={detailsForm.birthday ? 'text-[#202124]' : 'text-[#5F6368]'}>
                                  {birthdayDisplay}
                                </span>
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
                                          onChange={(event) => setBirthdayMonthValue(Number(event.target.value))}
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
                                          onChange={(event) => setBirthdayYearValue(Number(event.target.value))}
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
                                        onClick={() => changeBirthdayMonth(-1)}
                                        aria-label={copy.previousMonth}
                                      >
                                        <FiChevronLeft className="h-4 w-4" />
                                      </button>
                                      <p className="text-xs font-medium text-[#5F6368]">
                                        {monthLabelFormatter.format(birthdayMonth)}
                                      </p>
                                      <button
                                        type="button"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5F6368] transition-colors hover:bg-[#F1F3F4] hover:text-[#202124]"
                                        onClick={() => changeBirthdayMonth(1)}
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
                                      if (!day) {
                                        return <span key={`empty-${index}`} className="h-9 w-9" />;
                                      }

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
                                          onClick={() => selectBirthday(day)}
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
                                      onClick={() => {
                                        setDetailsForm((prev) => ({ ...prev, birthday: '' }));
                                        setBirthdayPickerOpen(false);
                                      }}
                                    >
                                      {copy.clear}
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center rounded-full bg-[#1A73E8] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1765cc]"
                                      onClick={() => setBirthdayPickerOpen(false)}
                                    >
                                      {copy.done}
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.gender}</label>
                            <div className="relative">
                              <select
                                className={`${inputClass} appearance-none pr-10`}
                                value={detailsForm.gender}
                                onChange={(event) => setDetailsForm((prev) => ({ ...prev, gender: event.target.value }))}
                              >
                                {copy.genderOptions.map((option) => (
                                  <option key={option.value || 'empty'} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <FiChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-[#5F6368]" />
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.nationalId}</label>
                            <input
                              className={`${inputClass} text-left`}
                              dir="ltr"
                              value={detailsForm.nationalId}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, nationalId: event.target.value }))}
                              placeholder={copy.placeholders.nationalId}
                              maxLength={96}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.phoneNumber}</label>
                            <input
                              className={`${inputClass} text-left`}
                              dir="ltr"
                              value={detailsForm.phoneNumber}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                              placeholder={copy.placeholders.phoneNumber}
                              maxLength={32}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.profileAvatar}</label>
                          <div className="flex flex-wrap items-center gap-3">
                            <button type="button" className={secondaryBtnClass} onClick={handleAvatarFabClick}>
                              {copy.uploadAvatar}
                            </button>
                            {detailsForm.avatarUrl ? (
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-full border border-[#DADCE0] px-4 py-2 text-sm font-medium text-[#5F6368] transition-all duration-200 hover:bg-[#F1F3F4]"
                                onClick={() => setDetailsForm((prev) => ({ ...prev, avatarUrl: '' }))}
                              >
                                {copy.removeAvatar}
                              </button>
                            ) : null}
                          </div>
                          <p className="text-xs text-[#5F6368]">{copy.avatarHint}</p>
                        </div>

                        <button type="submit" className={primaryBtnClass} disabled={detailsSaving}>
                          {detailsSaving ? copy.updating : copy.saveProfileDetails}
                        </button>
                      </form>
                    </article>

                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.assignedRoles}</h2>
                      {profile.roles.length ? (
                        <div className="mt-4 overflow-x-auto">
                          <table className={`w-full border-collapse text-sm ${isRtl ? 'text-right' : 'text-left'}`}>
                            <thead>
                              <tr className="border-b border-[#E8EAED] text-[#5F6368]">
                                <th className="px-2 py-2 font-normal">{copy.role}</th>
                                <th className="px-2 py-2 font-normal">{copy.code}</th>
                                <th className="px-2 py-2 font-normal">{copy.organization}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {profile.roles.map((role) => (
                                <tr key={role.assignmentRandId} className="border-b border-[#F1F3F4]">
                                  <td className="px-2 py-2 text-[#202124]">{role.roleName}</td>
                                  <td className="px-2 py-2 text-[#5F6368]">{role.roleCode}</td>
                                  <td className="px-2 py-2 text-[#5F6368]">{role.orgName || role.orgRandId}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm font-normal text-[#5F6368]">{copy.noActiveRoles}</p>
                      )}
                    </article>

                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.assignedOrganizations}</h2>
                      {profile.organizations.length ? (
                        <div className="mt-4 overflow-x-auto">
                          <table className={`w-full border-collapse text-sm ${isRtl ? 'text-right' : 'text-left'}`}>
                            <thead>
                              <tr className="border-b border-[#E8EAED] text-[#5F6368]">
                                <th className="px-2 py-2 font-normal">{copy.organization}</th>
                                <th className="px-2 py-2 font-normal">{copy.code}</th>
                                <th className="px-2 py-2 font-normal">{copy.assignedAt}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {profile.organizations.map((org) => (
                                <tr key={org.assignmentRandId} className="border-b border-[#F1F3F4]">
                                  <td className="px-2 py-2 text-[#202124]">{org.orgName}</td>
                                  <td className="px-2 py-2 text-[#5F6368]">{org.orgCode}</td>
                                  <td className="px-2 py-2 text-[#5F6368]">{formatDateTime(org.assignedAt, copy.notSet)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm font-normal text-[#5F6368]">{copy.noActiveOrganizations}</p>
                      )}
                    </article>
                  </section>
                ) : null}

                {activeRail === 'two-factor' ? (
                  <section id="section-two-factor" className="grid w-full grid-cols-1 gap-6 sm:w-[75%]">
                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">{copy.twoFactor.title}</h2>
                      <div className="mt-4 space-y-4">
                        <p className="text-sm text-[#5F6368]">
                          {copy.twoFactor.status}:{' '}
                          <span className="font-medium text-[#202124]">
                            {profile.security.twoFactorEnabled ? copy.twoFactor.enabled : copy.twoFactor.disabled}
                          </span>{' '}
                          · {copy.twoFactor.method}: <span className="font-medium text-[#202124]">{copy.twoFactor.methodAuthenticator}</span> · {copy.twoFactor.updated}{' '}
                          {formatDateTime(profile.security.updatedAt, copy.notSet)}
                        </p>

                        {!profile.security.twoFactorEnabled ? (
                          <>
                            <div className="rounded-2xl border border-[#DADCE0] bg-[#F8FAFF] p-4">
                              <p className="text-sm text-[#202124]">
                                {copy.twoFactor.setupSteps}
                              </p>
                              <div className="mt-3">
                                <button
                                  type="button"
                                  className={secondaryBtnClass}
                                  onClick={handleGenerateTwoFactorSetup}
                                  disabled={twoFaSaving}
                                >
                                  {twoFaSaving ? copy.twoFactor.preparing : copy.twoFactor.generateSetupSecret}
                                </button>
                              </div>
                            </div>

                            {twoFaSetup ? (
                              <div className="space-y-4 rounded-2xl border border-[#DADCE0] bg-white p-4">
                                <div className="grid gap-4 md:grid-cols-[240px,1fr] md:items-start">
                                  <div className="rounded-2xl border border-[#E8EAED] bg-white p-3">
                                    <div className="grid place-items-center rounded-xl bg-[#F8F9FA] p-2">
                                      {twoFaQrDataUrl ? (
                                        <img
                                          src={twoFaQrDataUrl}
                                          alt={copy.twoFactor.qrAlt}
                                          className="h-[220px] w-[220px]"
                                        />
                                      ) : (
                                        <div className="grid h-[220px] w-[220px] place-items-center text-center text-xs text-[#5F6368]">
                                          {twoFaQrLoading ? copy.twoFactor.qrGenerating : twoFaQrError || copy.twoFactor.qrNotReady}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <p className="text-sm text-[#202124]">
                                      {copy.twoFactor.scanHelp}
                                    </p>
                                    <div>
                                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#5F6368]">
                                        {copy.twoFactor.manualSetupKey}
                                      </p>
                                      <p className="mt-1 break-all font-mono text-sm text-[#202124]">{twoFaSetup.secret}</p>
                                    </div>
                                  </div>
                                </div>
                                <form className="space-y-3 border-t border-[#ECEFF3] pt-4" onSubmit={handleEnableTwoFactor}>
                                  <div>
                                    <label className="mb-1 block text-sm font-normal text-[#202124]">
                                      {copy.twoFactor.verificationCode}
                                    </label>
                                    <input
                                      className={`${inputClass} text-center font-mono tracking-[0.2em]`}
                                      dir="ltr"
                                      value={twoFaCode}
                                      onChange={(event) => setTwoFaCode(event.target.value.replace(/\D+/g, '').slice(0, 6))}
                                      inputMode="numeric"
                                      pattern="[0-9]{6}"
                                      minLength={6}
                                      maxLength={6}
                                      required
                                    />
                                  </div>
                                  <button type="submit" className={primaryBtnClass} disabled={twoFaSaving}>
                                    {twoFaSaving ? copy.twoFactor.enabling : copy.twoFactor.enableAction}
                                  </button>
                                </form>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="rounded-2xl border border-[#DADCE0] bg-white p-4">
                            <p className="text-sm text-[#5F6368]">
                              {copy.twoFactor.activeDescription}
                            </p>
                            <div className="mt-3">
                              <button
                                type="button"
                                className={secondaryBtnClass}
                                onClick={handleDisableTwoFactor}
                                disabled={twoFaSaving}
                              >
                                {twoFaSaving ? copy.twoFactor.disabling : copy.twoFactor.disableAction}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  </section>
                ) : null}
                </>
              ) : !loading ? (
                <div className={cardClass}>
                  <p className="text-sm font-normal text-[#5F6368]">{copy.signedOut}</p>
                  <Link href="/login" className={`${secondaryBtnClass} mt-4`}>
                    {copy.goToLogin}
                  </Link>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E8EAED] bg-white px-2 py-2 md:hidden" dir={localeDir(locale)}>
          <div className="mx-auto grid max-w-[640px] grid-cols-5 gap-1">
            {mobileBeforeHomeItems.map((item) => {
              const Icon = item.icon;
              const active = item.key === activeRail;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleSectionNav(item.key, item.sectionId)}
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
                onClick={() => handleSectionNav(mobileHomeItem.key, mobileHomeItem.sectionId)}
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
                  onClick={() => handleSectionNav(item.key, item.sectionId)}
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
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className={`flex h-full min-w-0 w-full flex-col items-center justify-center rounded-xl px-1 py-2 text-[11px] transition-all duration-200 ${
                  mobileMenuOpen || mobileMoreActive ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368]'
                }`}
              >
                <FiMoreHorizontal className="mb-1 h-4 w-4" />
                <span className="leading-tight">{copy.more}</span>
              </button>

              {mobileMenuOpen ? (
                <div className={`absolute bottom-14 z-50 w-52 overflow-hidden rounded-2xl border border-[#E8EAED] bg-white shadow-[0_8px_24px_rgba(60,64,67,.2)] ${isRtl ? 'left-0' : 'right-0'}`}>
                  <div className="p-1">
                    {mobileOverflowItems.map((item) => {
                      const Icon = item.icon;
                      const active = item.key === activeRail;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => handleSectionNav(item.key, item.sectionId)}
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
                      onClick={logout}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] ${isRtl ? 'text-right' : 'text-left'}`}
                    >
                      <FiLogOut className="h-4 w-4" />
                      <span>{copy.nav.logout}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </nav>
      </main>
    </>
  );
}
