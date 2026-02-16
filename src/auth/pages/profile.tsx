import Head from 'next/head';
import Link from 'next/link';
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiCamera,
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
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  sectionId: string;
}> = [
  { key: 'home', label: 'Home', icon: FiHome, sectionId: 'section-hero' },
  { key: 'personal-info', label: 'Personal Info', icon: FiUser, sectionId: 'section-personal-info-form' },
  { key: 'contact-info', label: 'Contact Info', icon: FiPhone, sectionId: 'section-contact-info' },
  { key: 'data-privacy', label: 'Data & Privacy', icon: FiDatabase, sectionId: 'section-privacy' },
  { key: 'security', label: 'Security', icon: FiShield, sectionId: 'section-security' },
  { key: 'two-factor', label: '2FA Settings', icon: FiKey, sectionId: 'section-two-factor' },
];

const mobilePrimaryKeys: RailKey[] = ['home', 'personal-info', 'security', 'two-factor'];
const mobileBeforeHomeKeys: RailKey[] = ['personal-info', 'security'];
const mobileAfterHomeKeys: RailKey[] = ['two-factor'];

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'n/a';
  return date.toLocaleString();
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

const infoRow = (label: string, value: string, onClick?: () => void) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex w-full items-center justify-between gap-3 px-1 py-3 text-left transition-all duration-200 hover:bg-[#F8F9FA]"
  >
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#5F6368]">{label}</p>
      <p className="mt-1 text-sm text-[#202124]">{value || 'Not set'}</p>
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
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
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
        pushToast('error', 'Session expired. Please sign in again.');
        setProfile(null);
        return;
      }

      const profileRes = await fetch('/api/profile', { credentials: 'include' });
      const profileData = (await profileRes.json()) as ProfilePayload & { error?: string };
      if (!profileRes.ok) {
        throw new Error(profileData.error || 'Failed to load profile');
      }

      applyProfileState(profileData.profile);
    } catch (loadError) {
      pushToast('error', loadError instanceof Error ? loadError.message : 'Failed to load profile');
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
        setTwoFaQrError('QR code is unavailable. Use the manual setup key.');
      })
      .finally(() => {
        if (cancelled) return;
        setTwoFaQrLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [twoFaSetup?.otpauthUri]);

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

  const profileAvatar = detailsForm.avatarUrl || profile?.user.avatarUrl || '';

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

    if (!AVATAR_ALLOWED_TYPES.has(file.type.toLowerCase())) {
      pushToast('error', 'Avatar file must be PNG, JPG, or WEBP.');
      return;
    }

    if (file.size > AVATAR_MAX_BYTES) {
      pushToast('error', 'Avatar file is too large. Maximum size is 2 MB.');
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
          }
          reject(new Error('Failed to read avatar file'));
        };
        reader.onerror = () => reject(new Error('Failed to read avatar file'));
        reader.readAsDataURL(file);
      });

      if (!dataUrl.startsWith('data:image/')) {
        pushToast('error', 'Avatar file is invalid.');
        return;
      }

      setDetailsForm((prev) => ({ ...prev, avatarUrl: dataUrl }));
      pushToast('success', 'Avatar image selected. Click "Save profile details" to apply.');
    } catch (uploadError) {
      pushToast('error', uploadError instanceof Error ? uploadError.message : 'Failed to load avatar image');
    }
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
          firstName: detailsForm.firstName,
          lastName: detailsForm.lastName,
          nationalId: detailsForm.nationalId,
          phoneNumber: detailsForm.phoneNumber,
          avatarUrl: detailsForm.avatarUrl,
          birthday: detailsForm.birthday,
          gender: detailsForm.gender,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; profile?: ProfilePayload['profile']; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to update profile details');
      if (data.profile) applyProfileState(data.profile);
      pushToast('success', 'Profile details updated successfully.');
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : 'Failed to update profile details');
    } finally {
      setDetailsSaving(false);
    }
  };

  const handleChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!csrfToken) return;

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      pushToast('error', 'New password and confirmation do not match.');
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
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
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
      pushToast('success', 'Password updated successfully.');
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : 'Failed to change password');
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
      if (!res.ok || !data.setup) throw new Error(data.error || 'Failed to prepare authenticator setup');
      setTwoFaSetup(data.setup);
      setTwoFaCode('');
      pushToast('success', 'Authenticator setup generated. Add it to your app and confirm with verification code.');
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : 'Failed to prepare authenticator setup');
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
      if (!res.ok || !data.security) throw new Error(data.error || 'Failed to enable 2FA');
      if (profile) {
        applyProfileState({ ...profile, security: data.security });
      }
      setTwoFaCode('');
      setTwoFaSetup(null);
      pushToast('success', 'Two-factor authentication enabled.');
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : 'Failed to enable 2FA');
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
      if (!res.ok || !data.security) throw new Error(data.error || 'Failed to disable 2FA');
      if (profile) {
        applyProfileState({ ...profile, security: data.security });
      }
      setTwoFaCode('');
      setTwoFaSetup(null);
      pushToast('success', 'Two-factor authentication disabled.');
    } catch (submitError) {
      pushToast('error', submitError instanceof Error ? submitError.message : 'Failed to disable 2FA');
    } finally {
      setTwoFaSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>Profile & Settings | Google Account Style</title>
      </Head>

      <main className="min-h-screen overflow-x-hidden bg-[#F6F8FC] pb-20 pt-6 text-[#202124] md:pb-8">
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

        <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-[1400px] items-stretch gap-6 px-3 sm:px-4">
          <aside className="hidden w-[280px] shrink-0 md:block">
            <nav
              className={`${cardClass} md:fixed md:top-6 md:w-[280px] md:max-h-[calc(100vh-3rem)] md:overflow-y-auto md:hide-scrollbar p-3`}
              style={{ left: desktopRailLeft }}
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
                        className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm font-normal transition-all duration-200 ${
                          active
                            ? 'bg-[#E8F0FE] text-[#1A73E8]'
                            : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
                        }`}
                      >
                        <Icon className="h-6 w-6" />
                        <span>{item.label}</span>
                      </button>
                    </li>
                  );
                })}
                <li className="pt-2">
                  <button
                    type="button"
                    onClick={logout}
                    className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm font-medium text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA]"
                  >
                    <FiLogOut className="h-6 w-6" />
                    <span>Logout</span>
                  </button>
                </li>
              </ul>
            </nav>
          </aside>

          <section className="min-w-0 flex w-full max-w-full flex-1 flex-col justify-center gap-6">
            {loading ? <div className={`${cardClass} text-sm text-[#5F6368]`}>Loading profile...</div> : null}
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
                          <img src={profileAvatar} alt="Profile avatar" className="h-full w-full object-cover" />
                        ) : (
                          avatarInitials
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleAvatarFabClick}
                        className="absolute bottom-1 right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#DADCE0] bg-white text-[#1A73E8] shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)] transition-all duration-200 hover:bg-[#E8F0FE] active:brightness-95"
                        aria-label="Change avatar"
                      >
                        <FiCamera className="h-4 w-4" />
                      </button>
                    </div>

                    <h1 className="mt-5 text-[28px] font-normal text-[#202124]">Welcome, {profile.user.firstName}</h1>
                    <p className="mx-auto mt-2 max-w-3xl text-sm font-normal text-[#5F6368]">
                      Manage your info, privacy, and security to make Google work better for you.
                    </p>

                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-[#5F6368]">
                      <span className="rounded-full bg-[#F1F3F4] px-3 py-1">
                        Last login: {formatDateTime(profile.audit.lastLoginAt)}
                      </span>
                      <span className="rounded-full bg-[#F1F3F4] px-3 py-1">
                        Last seen: {formatDateTime(profile.audit.lastSeenAt)}
                      </span>
                      <span className="max-w-full break-all rounded-full bg-[#F1F3F4] px-3 py-1">
                        {profile.user.email}
                      </span>
                    </div>

                    <div className="mt-6 flex flex-wrap justify-center gap-3">
                      {session.user.isAuthAdmin ? (
                        <Link href="/admin" className={secondaryBtnClass}>
                          Open Auth Admin
                        </Link>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {activeRail === 'contact-info' ? (
                  <section id="section-contact-info" className="grid w-full grid-cols-1 gap-6 sm:w-[75%]">
                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">Contact Info</h2>
                      <div className="mt-4 divide-y divide-[#E8EAED]">
                        {infoRow('Primary Email', profile.user.email)}
                        {infoRow('Recovery Email', 'Not set')}
                        {infoRow('Phone Number', profile.user.phoneNumber || 'Not set')}
                      </div>
                    </article>
                  </section>
                ) : null}

                {activeRail === 'data-privacy' ? (
                  <section id="section-privacy" className={`${cardClass} w-full sm:w-[75%]`}>
                    <div className="flex flex-col gap-4 rounded-[20px] border border-[#D2E3FC] bg-[#E8F0FE] p-5 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-2">
                        <h3 className="text-lg font-normal text-[#202124]">Privacy Check-up</h3>
                        <p className="text-sm font-normal text-[#5F6368]">
                          Guided step-by-step through your key privacy settings.
                        </p>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1A73E8] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#DBE8FD] active:brightness-95"
                        >
                          Take Check-up
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
                      <h2 className="text-xl font-normal text-[#202124]">Password Settings</h2>
                      <form className="mt-4 space-y-4" onSubmit={handleChangePassword}>
                        {profile.security.hasPassword ? (
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">Current password</label>
                            <input
                              type="password"
                              className={inputClass}
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
                          <label className="mb-1 block text-sm font-normal text-[#202124]">New password</label>
                          <input
                            type="password"
                            className={inputClass}
                            value={passwordForm.newPassword}
                            onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                            autoComplete="new-password"
                            minLength={10}
                            required
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-normal text-[#202124]">Confirm new password</label>
                          <input
                            type="password"
                            className={inputClass}
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
                          {passwordSaving ? 'Updating...' : profile.security.hasPassword ? 'Update password' : 'Set password'}
                        </button>
                      </form>
                    </article>

                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">Last Login & Session</h2>
                      <div className="mt-4 space-y-3 text-sm text-[#5F6368]">
                        <p>
                          <span className="font-normal text-[#202124]">Last login:</span>{' '}
                          {formatDateTime(profile.audit.lastLoginAt)}
                        </p>
                        <p>
                          <span className="font-normal text-[#202124]">IP address:</span>{' '}
                          {profile.audit.lastLoginIp || 'n/a'}
                        </p>
                        <p>
                          <span className="font-normal text-[#202124]">User agent:</span>{' '}
                          {profile.audit.lastLoginUserAgent || 'n/a'}
                        </p>
                        <p>
                          <span className="font-normal text-[#202124]">Last seen:</span>{' '}
                          {formatDateTime(profile.audit.lastSeenAt)}
                        </p>
                      </div>
                    </article>
                  </section>
                ) : null}

                {activeRail === 'personal-info' ? (
                  <section id="section-personal-info-form" className="grid w-full grid-cols-1 gap-6 sm:w-[75%] xl:grid-cols-2">
                    <article id="section-settings" className={`${cardClass} xl:col-span-2`}>
                      <h2 className="text-xl font-normal text-[#202124]">Personal Info</h2>
                      <form className="mt-4 space-y-4" onSubmit={handleSaveDetails}>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">First name</label>
                            <input
                              className={inputClass}
                              value={detailsForm.firstName}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, firstName: event.target.value }))}
                              maxLength={120}
                              required
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">Last name</label>
                            <input
                              className={inputClass}
                              value={detailsForm.lastName}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, lastName: event.target.value }))}
                              maxLength={120}
                              required
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">Birthday</label>
                            <input
                              type="date"
                              className={inputClass}
                              value={detailsForm.birthday}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, birthday: event.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">Gender</label>
                            <input
                              className={inputClass}
                              value={detailsForm.gender}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, gender: event.target.value }))}
                              placeholder="e.g. Female"
                              maxLength={40}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">National ID</label>
                            <input
                              className={inputClass}
                              value={detailsForm.nationalId}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, nationalId: event.target.value }))}
                              maxLength={96}
                              required
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-sm font-normal text-[#202124]">Phone number</label>
                            <input
                              className={inputClass}
                              value={detailsForm.phoneNumber}
                              onChange={(event) => setDetailsForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                              maxLength={32}
                              required
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="mb-1 block text-sm font-normal text-[#202124]">Profile avatar</label>
                          <div className="flex flex-wrap items-center gap-3">
                            <button type="button" className={secondaryBtnClass} onClick={handleAvatarFabClick}>
                              Upload avatar
                            </button>
                            {detailsForm.avatarUrl ? (
                              <button
                                type="button"
                                className="inline-flex items-center justify-center rounded-full border border-[#DADCE0] px-4 py-2 text-sm font-medium text-[#5F6368] transition-all duration-200 hover:bg-[#F1F3F4]"
                                onClick={() => setDetailsForm((prev) => ({ ...prev, avatarUrl: '' }))}
                              >
                                Remove avatar
                              </button>
                            ) : null}
                          </div>
                          <p className="text-xs text-[#5F6368]">PNG, JPG, WEBP up to 2 MB.</p>
                        </div>

                        <button type="submit" className={primaryBtnClass} disabled={detailsSaving}>
                          {detailsSaving ? 'Saving...' : 'Save profile details'}
                        </button>
                      </form>
                    </article>

                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">Assigned Roles</h2>
                      {profile.roles.length ? (
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-[#E8EAED] text-[#5F6368]">
                                <th className="px-2 py-2 font-normal">Role</th>
                                <th className="px-2 py-2 font-normal">Code</th>
                                <th className="px-2 py-2 font-normal">Organization</th>
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
                        <p className="mt-4 text-sm font-normal text-[#5F6368]">No active roles assigned.</p>
                      )}
                    </article>

                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">Assigned Organizations</h2>
                      {profile.organizations.length ? (
                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-[#E8EAED] text-[#5F6368]">
                                <th className="px-2 py-2 font-normal">Organization</th>
                                <th className="px-2 py-2 font-normal">Code</th>
                                <th className="px-2 py-2 font-normal">Assigned At</th>
                              </tr>
                            </thead>
                            <tbody>
                              {profile.organizations.map((org) => (
                                <tr key={org.assignmentRandId} className="border-b border-[#F1F3F4]">
                                  <td className="px-2 py-2 text-[#202124]">{org.orgName}</td>
                                  <td className="px-2 py-2 text-[#5F6368]">{org.orgCode}</td>
                                  <td className="px-2 py-2 text-[#5F6368]">{formatDateTime(org.assignedAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm font-normal text-[#5F6368]">No active organizations assigned.</p>
                      )}
                    </article>
                  </section>
                ) : null}

                {activeRail === 'two-factor' ? (
                  <section id="section-two-factor" className="grid w-full grid-cols-1 gap-6 sm:w-[75%]">
                    <article className={cardClass}>
                      <h2 className="text-xl font-normal text-[#202124]">2FA Settings</h2>
                      <div className="mt-4 space-y-4">
                        <p className="text-sm text-[#5F6368]">
                          Status:{' '}
                          <span className="font-medium text-[#202124]">
                            {profile.security.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                          </span>{' '}
                          · Method: <span className="font-medium text-[#202124]">Authenticator app</span> · Updated{' '}
                          {formatDateTime(profile.security.updatedAt)}
                        </p>

                        {!profile.security.twoFactorEnabled ? (
                          <>
                            <div className="rounded-2xl border border-[#DADCE0] bg-[#F8FAFF] p-4">
                              <p className="text-sm text-[#202124]">
                                1) Generate a setup secret. 2) Add it to Google Authenticator (or any TOTP app). 3)
                                Enter the 6-digit code to enable.
                              </p>
                              <div className="mt-3">
                                <button
                                  type="button"
                                  className={secondaryBtnClass}
                                  onClick={handleGenerateTwoFactorSetup}
                                  disabled={twoFaSaving}
                                >
                                  {twoFaSaving ? 'Preparing...' : 'Generate setup secret'}
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
                                          alt="Scan this QR code with your authenticator app"
                                          className="h-[220px] w-[220px]"
                                        />
                                      ) : (
                                        <div className="grid h-[220px] w-[220px] place-items-center text-center text-xs text-[#5F6368]">
                                          {twoFaQrLoading ? 'Generating QR code...' : twoFaQrError || 'QR code not ready'}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="space-y-3">
                                    <p className="text-sm text-[#202124]">
                                      Scan this QR code in Google Authenticator, Microsoft Authenticator, or any TOTP app.
                                    </p>
                                    <div>
                                      <p className="text-xs font-medium uppercase tracking-[0.08em] text-[#5F6368]">
                                        Manual setup key
                                      </p>
                                      <p className="mt-1 break-all font-mono text-sm text-[#202124]">{twoFaSetup.secret}</p>
                                    </div>
                                  </div>
                                </div>
                                <form className="space-y-3 border-t border-[#ECEFF3] pt-4" onSubmit={handleEnableTwoFactor}>
                                  <div>
                                    <label className="mb-1 block text-sm font-normal text-[#202124]">
                                      Authenticator verification code
                                    </label>
                                    <input
                                      className={`${inputClass} text-center font-mono tracking-[0.2em]`}
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
                                    {twoFaSaving ? 'Enabling...' : 'Enable 2FA'}
                                  </button>
                                </form>
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div className="rounded-2xl border border-[#DADCE0] bg-white p-4">
                            <p className="text-sm text-[#5F6368]">
                              Two-factor authentication is active for this account.
                            </p>
                            <div className="mt-3">
                              <button
                                type="button"
                                className={secondaryBtnClass}
                                onClick={handleDisableTwoFactor}
                                disabled={twoFaSaving}
                              >
                                {twoFaSaving ? 'Disabling...' : 'Disable 2FA'}
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
                  <p className="text-sm font-normal text-[#5F6368]">You are not signed in.</p>
                  <Link href="/login" className={`${secondaryBtnClass} mt-4`}>
                    Go to login
                  </Link>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E8EAED] bg-white px-2 py-2 md:hidden">
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
                  <span className="leading-tight">{item.label.split(' ').slice(0, 2).join(' ')}</span>
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
                  <span className="leading-tight">{item.label.split(' ').slice(0, 2).join(' ')}</span>
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
                <span className="leading-tight">More</span>
              </button>
              {mobileMenuOpen ? (
                <div className="absolute bottom-14 right-0 z-50 w-52 overflow-hidden rounded-2xl border border-[#E8EAED] bg-white shadow-[0_8px_24px_rgba(60,64,67,.2)]">
                  <div className="p-1">
                    {mobileOverflowItems.map((item) => {
                      const Icon = item.icon;
                      const active = item.key === activeRail;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => handleSectionNav(item.key, item.sectionId)}
                          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
                            active ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368] hover:bg-[#F1F3F4]'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                    <div className="my-1 h-px bg-[#E8EAED]" />
                    <button
                      type="button"
                      onClick={logout}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA]"
                    >
                      <FiLogOut className="h-4 w-4" />
                      <span>Logout</span>
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
