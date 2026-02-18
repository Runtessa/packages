import Head from 'next/head';
import Image from 'next/image';
import {
  FormEvent,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import branding from '../branding.json';
import { LoginHeader } from '../components/login/LoginHeader';
import { LoginModeContent } from '../components/login/LoginModeContent';
import { useLoginToasts } from '../components/login/hooks/useLoginToasts';
import { useLoginActions } from '../components/login/hooks/useLoginActions';
import { useLoginBootstrap } from '../components/login/hooks/useLoginBootstrap';
import { useOtpCooldown } from '../components/login/hooks/useOtpCooldown';
import { useOtpInputs } from '../components/login/hooks/useOtpInputs';
import { usePhoneNumberState } from '../components/login/hooks/usePhoneNumberState';
import { LoginToastStack } from '../components/login/ToastStack';
import { localeDir, useUiLocale } from '../lib/ui/locale';
import { getAuthMessages } from '../lib/ui/i18n';
import {
  Mode,
  SigninStep,
  SignupStep,
  one,
  primaryBtnClass,
  secondaryBtnClass,
  tenantFromReturnTo,
  tenantOrgIdFromReturnTo,
} from '../components/login/config';

export default function LoginPage() {
  const router = useRouter();
  const { locale, isRtl, setLocale } = useUiLocale();
  const copy = getAuthMessages(locale).login;
  const [mode, setMode] = useState<Mode>('signin');
  const [signinStep, setSigninStep] = useState<SigninStep>('phone');
  const [signupStep, setSignupStep] = useState<SignupStep>('phone');

  const [allowRegistration, setAllowRegistration] = useState(true);
  const [password, setPassword] = useState('');

  const {
    selectedCountry,
    formattedNationalPhone,
    fullPhoneNumber,
    countryPickerOpen,
    setCountryPickerOpen,
    countryPickerRef,
    applyPhoneValue,
    handleCountryChange,
    handlePhoneInputChange,
  } = usePhoneNumberState();

  const {
    signinOtpDigits,
    signupOtpDigits,
    signinOtpRefs,
    signupOtpRefs,
    clearOtpDigits,
    otpCodeFor,
    handleOtpDigitChange,
    handleOtpKeyDown,
    handleOtpPaste,
  } = useOtpInputs();

  const { otpWaitUntilMs, setOtpWaitUntilMs, resendRemainingSec } = useOtpCooldown();
  const { toasts, pushToast } = useLoginToasts();

  const returnTo = one(router.query.returnTo) || '/profile';
  const clientId = one(router.query.client_id);
  const tenantName = one(router.query.tenant_name) || tenantFromReturnTo(returnTo);
  const tenantOrgRandId = one(router.query.tenant_org_id) || tenantOrgIdFromReturnTo(returnTo);
  const loginTitle = tenantName ? `${copy.access} ${tenantName}` : copy.loginToProfile;
  const mapServerError = useCallback(
    (value: unknown, fallback: string): string => {
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
    },
    [copy.tenantMismatch],
  );

  const authContextBody = useMemo(() => {
    const payload: Record<string, string> = { returnTo };
    if (clientId) payload.client_id = clientId;
    if (tenantName) payload.tenant_name = tenantName;
    if (tenantOrgRandId) payload.tenant_org_id = tenantOrgRandId;
    return payload;
  }, [clientId, returnTo, tenantName, tenantOrgRandId]);

  const {
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
  } = useLoginActions({
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
  });

  useLoginBootstrap({
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
  });

  return (
    <>
      <Head>
        <title>{copy.headTitle}</title>
      </Head>

      <main className="auth-login-page relative min-h-[100dvh] overflow-x-hidden bg-[#F6F8FC] text-[#202124]" dir={localeDir(locale)}>
        <div className="pointer-events-none absolute bottom-8 left-8 z-0 login-bg-logo opacity-[0.08]">
          <Image src="/images/lm_dark.png" alt="" width={180} height={180} priority className="h-[130px] w-auto md:h-[160px]" />
        </div>

        <LoginToastStack toasts={toasts} isRtl={isRtl} />

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[1400px] items-end justify-center px-4 pb-10 pt-4 sm:px-6 sm:pt-6 md:items-center md:pb-0">
          <section className="w-full max-w-[520px] login-shell-enter">
            <LoginHeader
              copy={copy}
              mode={mode}
              loginTitle={loginTitle}
              tenantName={tenantName}
              locale={locale}
              setLocale={setLocale}
              onSelectSignin={() => {
                clearOtpProgress();
                setMode('signin');
                setSigninStep('phone');
                clearOtpDigits('signin');
              }}
              onSelectSignup={() => {
                clearOtpProgress();
                setMode('signup');
                setSignupStep('phone');
                clearOtpDigits('signup');
              }}
            />

            <div className="mt-6 min-h-[340px]">
              <LoginModeContent
                copy={copy}
                mode={mode}
                signinStep={signinStep}
                signupStep={signupStep}
                isRtl={isRtl}
                selectedCountry={selectedCountry}
                formattedNationalPhone={formattedNationalPhone}
                countryPickerOpen={countryPickerOpen}
                setCountryPickerOpen={setCountryPickerOpen}
                countryPickerRef={countryPickerRef}
                onCountryChange={handleCountryChange}
                onPhoneInputChange={handlePhoneInputChange}
                onSigninPhoneContinue={handleSigninPhoneContinue}
                password={password}
                setPassword={setPassword}
                onSigninPasswordSubmit={handleSigninPasswordSubmit}
                onUseOtp={() => {
                  void startOtpLogin();
                }}
                onEnterSigninPhoneStep={enterSigninPhoneStep}
                signinOtpDigits={signinOtpDigits}
                signinOtpRefs={signinOtpRefs}
                onSigninDigitChange={(index, value) => handleOtpDigitChange('signin', index, value)}
                onSigninKeyDown={(index, event) => handleOtpKeyDown('signin', index, event)}
                onSigninPaste={(event) => handleOtpPaste('signin', event)}
                onSigninOtpVerify={handleSigninOtpVerify}
                onResetSignin={() => {
                  clearOtpProgress();
                  setSigninStep('phone');
                  clearOtpDigits('signin');
                }}
                onResendSigninOtp={() => {
                  void startOtpLogin();
                }}
                onSigninTwoFactorVerify={handleSigninTwoFactorVerify}
                signupOtpDigits={signupOtpDigits}
                signupOtpRefs={signupOtpRefs}
                onSignupDigitChange={(index, value) => handleOtpDigitChange('signup', index, value)}
                onSignupKeyDown={(index, event) => handleOtpKeyDown('signup', index, event)}
                onSignupPaste={(event) => handleOtpPaste('signup', event)}
                onSignupPhoneSubmit={handleSignupPhoneSubmit}
                onSignupOtpVerify={handleSignupOtpVerify}
                onResetSignup={() => {
                  clearOtpProgress();
                  setSignupStep('phone');
                }}
                onResendSignupOtp={() => {
                  void requestSignupOtp();
                }}
                primaryBtnClass={primaryBtnClass}
                secondaryBtnClass={secondaryBtnClass}
                busyAction={busyAction}
                resendRemainingSec={resendRemainingSec}
                allowRegistration={allowRegistration}
              />
            </div>

            <p className="mt-6 text-center text-xs text-[#5F6368]">{branding.copyright}</p>
          </section>
        </div>
      </main>
    </>
  );
}
