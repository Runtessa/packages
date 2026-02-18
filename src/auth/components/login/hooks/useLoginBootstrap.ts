import { useEffect } from 'react';
import { NextRouter } from 'next/router';
import { Mode, OtpProgressState, OTP_PROGRESS_STORAGE_KEY, SigninStep, SignupStep, one, parseJsonSafe } from '../config';
import { LoginCopy } from '../forms/types';

type UseLoginBootstrapArgs = {
  router: NextRouter;
  copy: LoginCopy;
  clientId: string;
  tenantName: string;
  setMode: (mode: Mode) => void;
  setSigninStep: (step: SigninStep) => void;
  setSignupStep: (step: SignupStep) => void;
  setAllowRegistration: (allowed: boolean) => void;
  setOtpWaitUntilMs: (value: number) => void;
  applyPhoneValue: (value: string) => void;
  clearOtpProgress: () => void;
  pushToast: (type: 'success' | 'error', message: string) => void;
  mapServerError: (value: unknown, fallback: string) => string;
};

export const useLoginBootstrap = ({
  router,
  copy,
  clientId,
  tenantName,
  setMode,
  setSigninStep,
  setSignupStep,
  setAllowRegistration,
  setOtpWaitUntilMs,
  applyPhoneValue,
  clearOtpProgress,
  pushToast,
  mapServerError,
}: UseLoginBootstrapArgs) => {
  useEffect(() => {
    const requestedMode = one(router.query.mode).toLowerCase();
    if (requestedMode === 'signup') {
      setMode('signup');
      setSignupStep('phone');
      return;
    }
    setMode('signin');
  }, [router.query.mode, setMode, setSignupStep]);

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
  }, [clientId, tenantName, setAllowRegistration, pushToast, copy.registrationDisabledTenant, copy.registrationPolicyFailed]);

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
        if (require2fa) setSigninStep('twofactor');

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
  }, [
    router.isReady,
    router.query.phone_number,
    applyPhoneValue,
    clearOtpProgress,
    mapServerError,
    pushToast,
    setMode,
    setOtpWaitUntilMs,
    setSigninStep,
    setSignupStep,
  ]);
};
