import { ComponentType } from 'react';
import {
  FiCalendar,
  FiDatabase,
  FiHome,
  FiKey,
  FiPhone,
  FiShield,
  FiUser,
  FiChevronRight,
} from 'react-icons/fi';

export interface SessionPayload {
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

export interface ProfilePayload {
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

export interface ProfileDetailsFormState {
  firstName: string;
  lastName: string;
  nationalId: string;
  phoneNumber: string;
  avatarUrl: string;
  birthday: string;
  gender: string;
}

export interface ProfilePasswordFormState {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface TwoFactorSetupState {
  secret: string;
  otpauthUri: string;
}

export type RailKey =
  | 'home'
  | 'personal-info'
  | 'contact-info'
  | 'data-privacy'
  | 'security'
  | 'two-factor';

export const railItems: Array<{
  key: RailKey;
  icon: ComponentType<{ className?: string }>;
  sectionId: string;
}> = [
  { key: 'home', icon: FiHome, sectionId: 'section-hero' },
  { key: 'personal-info', icon: FiUser, sectionId: 'section-personal-info-form' },
  { key: 'contact-info', icon: FiPhone, sectionId: 'section-contact-info' },
  { key: 'data-privacy', icon: FiDatabase, sectionId: 'section-privacy' },
  { key: 'security', icon: FiShield, sectionId: 'section-security' },
  { key: 'two-factor', icon: FiKey, sectionId: 'section-two-factor' },
];

export const mobilePrimaryKeys: RailKey[] = ['home', 'personal-info', 'security', 'two-factor'];
export const mobileBeforeHomeKeys: RailKey[] = ['personal-info', 'security'];
export const mobileAfterHomeKeys: RailKey[] = ['two-factor'];

export const formatDateTime = (value: string | null | undefined, fallback = 'n/a'): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return fallback;
  return date.toLocaleString();
};

const BIRTHDAY_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const monthLabelFormatterFor = (calendarLocale: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(calendarLocale || 'en-US', { month: 'long', year: 'numeric' });

export const calendarMonthOptionsFor = (calendarLocale: string): Array<{ value: number; label: string }> =>
  Array.from({ length: 12 }, (_, month) => ({
    value: month,
    label: new Intl.DateTimeFormat(calendarLocale || 'en-US', { month: 'long' }).format(new Date(2020, month, 1)),
  }));

export const parseDateOnly = (value: string): Date | null => {
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

export const toDateOnly = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const monthStart = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), 1);

export const buildCalendarGrid = (month: Date): Array<Date | null> => {
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

export const isSameDay = (left: Date | null, right: Date | null): boolean => {
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
};

export const initialsFrom = (firstName: string, lastName: string): string => {
  const first = String(firstName || '').trim().charAt(0);
  const last = String(lastName || '').trim().charAt(0);
  const fallback = String(firstName || lastName || '').trim().charAt(0);
  return `${first}${last || fallback}`.toUpperCase() || 'U';
};

export const cardClass = 'rounded-[24px] p-6';

export const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition-all duration-200 focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20';

export const primaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#1765cc] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#F6F9FE] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';

export const desktopRailLeft = 'max(0.75rem, calc((100vw - 1400px) / 2 + 0.75rem))';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export const infoRow = (label: string, value: string, onClick?: () => void, isRtl = false) => (
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

export type ToastType = 'success' | 'error';

export interface ToastEntry {
  id: number;
  type: ToastType;
  message: string;
}

export interface CalendarState {
  month: Date;
  selected: Date | null;
}

export const calendarIcon = FiCalendar;
