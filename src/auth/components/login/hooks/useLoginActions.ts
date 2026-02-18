import { FormEvent, useMemo, useState } from 'react';
import { Mode, OtpContext, SigninStep, SignupStep, parseJsonSafe } from '../config';
import { LoginCopy } from '../forms/types';
import {
  clearOtpProgress,
  createServerErrorMapper,
  persistOtpProgress,
  postJson,
} from './loginActionUtils';

type UseLoginActionsArgs = {
  copy: LoginCopy;
  returnTo: string;
  fullPhoneNumber: string;
  authContextBody: Record<string, string>;
  allowRegistration: boolean;
  password: string;
  setPassword: (value: string) => void;
  setMode: (mode: Mode) => void;
  setSigninStep: (step: SigninStep) => void;
  setSignupStep: (step: SignupStep) => void;
  setOtpWaitUntilMs: (value: number) => void;
  pushToast: (type: 'success' | 'error', message: string) => void;
  otpCodeFor: (context: OtpContext) => string;
  clearOtpDigits: (context: OtpContext) => void;
};

export const useLoginActions = ({
  copy,
  returnTo,
  fullPhoneNumber,
  authContextBody,
  allowRegistration,
  password,
  setPassword,
  setMode,
  setSigninStep,
  setSignupStep,
  setOtpWaitUntilMs,
  pushToast,
  otpCodeFor,
  clearOtpDigits,
}: UseLoginActionsArgs) => {
  const [busyAction, setBusyAction] = useState<string>('');

  const mapServerError = useMemo(
    () => createServerErrorMapper(copy.tenantMismatch),
    [copy.tenantMismatch],
  );

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
      pushToast('success', debugCode ? copy.codeSentDev.replace('{code}', debugCode) : copy.codeSent);
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

    setBusyAction('signin-otp-verify');
    try {
      const { ok, status, data } = await postJson('/auth/login/otp/complete', {
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
      pushToast('success', debugCode ? copy.codeSentDev.replace('{code}', debugCode) : copy.codeSent);
    } catch {
      pushToast('error', copy.failedSendCode);
    } finally {
      setBusyAction('');
    }
  };

  const handleSignupPhoneSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await requestSignupOtp();
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

  return {
    busyAction,
    enterSigninPhoneStep,
    startOtpLogin,
    handleSigninPhoneContinue,
    handleSigninPasswordSubmit,
    handleSigninOtpVerify,
    handleSigninTwoFactorVerify,
    handleSignupPhoneSubmit,
    requestSignupOtp,
    handleSignupOtpVerify,
    clearOtpProgress,
  };
};
