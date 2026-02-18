import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_MAX_BYTES,
  ProfileDetailsFormState,
  ProfilePasswordFormState,
  ProfilePayload,
  SessionPayload,
  ToastType,
  TwoFactorSetupState,
} from '../config';
import { ProfileCopy } from '../sections/types';

type UseProfileDataArgs = {
  copy: ProfileCopy;
  pushToast: (type: ToastType, message: string) => void;
};

export const useProfileData = ({ copy, pushToast }: UseProfileDataArgs) => {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [profile, setProfile] = useState<ProfilePayload['profile'] | null>(null);
  const [loading, setLoading] = useState(true);

  const [detailsSaving, setDetailsSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [twoFaSaving, setTwoFaSaving] = useState(false);

  const [detailsForm, setDetailsForm] = useState<ProfileDetailsFormState>({
    firstName: '',
    lastName: '',
    nationalId: '',
    phoneNumber: '',
    avatarUrl: '',
    birthday: '',
    gender: '',
  });

  const [passwordForm, setPasswordForm] = useState<ProfilePasswordFormState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaSetup, setTwoFaSetup] = useState<TwoFactorSetupState | null>(null);
  const [twoFaQrDataUrl, setTwoFaQrDataUrl] = useState('');
  const [twoFaQrLoading, setTwoFaQrLoading] = useState(false);
  const [twoFaQrError, setTwoFaQrError] = useState('');

  const csrfToken = session?.csrfToken || '';

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

  const logout = async () => {
    if (!csrfToken) return;
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
      const data = (await res.json()) as { ok?: boolean; setup?: TwoFactorSetupState; error?: string };
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

  return {
    session,
    profile,
    loading,
    csrfToken,
    detailsSaving,
    passwordSaving,
    twoFaSaving,
    detailsForm,
    setDetailsForm,
    passwordForm,
    setPasswordForm,
    twoFaCode,
    setTwoFaCode,
    twoFaSetup,
    twoFaQrDataUrl,
    twoFaQrLoading,
    twoFaQrError,
    handleAvatarFileChange,
    logout,
    handleSaveDetails,
    handleChangePassword,
    handleGenerateTwoFactorSetup,
    handleEnableTwoFactor,
    handleDisableTwoFactor,
  };
};
