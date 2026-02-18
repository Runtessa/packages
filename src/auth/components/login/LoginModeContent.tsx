import { SigninOtpForm } from './forms/SigninOtpForm';
import { SigninPasswordForm } from './forms/SigninPasswordForm';
import { SigninPhoneForm } from './forms/SigninPhoneForm';
import { SigninTwoFactorForm } from './forms/SigninTwoFactorForm';
import { SignupOtpForm } from './forms/SignupOtpForm';
import { SignupPhoneForm } from './forms/SignupPhoneForm';
import { CountryOption, Mode, SigninStep, SignupStep } from './config';
import { AuthMessages } from '../../lib/ui/i18n';
import { ClipboardEvent, Dispatch, FormEvent, KeyboardEvent, MutableRefObject, RefObject, SetStateAction } from 'react';

interface LoginModeContentProps {
  copy: AuthMessages['login'];
  mode: Mode;
  signinStep: SigninStep;
  signupStep: SignupStep;
  isRtl: boolean;
  selectedCountry: CountryOption;
  formattedNationalPhone: string;
  countryPickerOpen: boolean;
  setCountryPickerOpen: Dispatch<SetStateAction<boolean>>;
  countryPickerRef: RefObject<HTMLDivElement | null>;
  onCountryChange: (code: string) => void;
  onPhoneInputChange: (value: string) => void;
  onSigninPhoneContinue: (event: FormEvent) => Promise<void>;
  password: string;
  setPassword: (value: string) => void;
  onSigninPasswordSubmit: (event: FormEvent) => Promise<void>;
  onUseOtp: () => void;
  onEnterSigninPhoneStep: () => void;
  signinOtpDigits: string[];
  signinOtpRefs: MutableRefObject<Array<HTMLInputElement | null>>;
  onSigninDigitChange: (index: number, value: string) => void;
  onSigninKeyDown: (index: number, event: KeyboardEvent<HTMLInputElement>) => void;
  onSigninPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onSigninOtpVerify: (event: FormEvent) => Promise<void>;
  onResetSignin: () => void;
  onResendSigninOtp: () => void;
  onSigninTwoFactorVerify: (event: FormEvent) => Promise<void>;
  signupOtpDigits: string[];
  signupOtpRefs: MutableRefObject<Array<HTMLInputElement | null>>;
  onSignupDigitChange: (index: number, value: string) => void;
  onSignupKeyDown: (index: number, event: KeyboardEvent<HTMLInputElement>) => void;
  onSignupPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onSignupPhoneSubmit: (event: FormEvent) => Promise<void>;
  onSignupOtpVerify: (event: FormEvent) => Promise<void>;
  onResetSignup: () => void;
  onResendSignupOtp: () => void;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  busyAction: string;
  resendRemainingSec: number;
  allowRegistration: boolean;
}

export const LoginModeContent = ({
  copy,
  mode,
  signinStep,
  signupStep,
  isRtl,
  selectedCountry,
  formattedNationalPhone,
  countryPickerOpen,
  setCountryPickerOpen,
  countryPickerRef,
  onCountryChange,
  onPhoneInputChange,
  onSigninPhoneContinue,
  password,
  setPassword,
  onSigninPasswordSubmit,
  onUseOtp,
  onEnterSigninPhoneStep,
  signinOtpDigits,
  signinOtpRefs,
  onSigninDigitChange,
  onSigninKeyDown,
  onSigninPaste,
  onSigninOtpVerify,
  onResetSignin,
  onResendSigninOtp,
  onSigninTwoFactorVerify,
  signupOtpDigits,
  signupOtpRefs,
  onSignupDigitChange,
  onSignupKeyDown,
  onSignupPaste,
  onSignupPhoneSubmit,
  onSignupOtpVerify,
  onResetSignup,
  onResendSignupOtp,
  primaryBtnClass,
  secondaryBtnClass,
  busyAction,
  resendRemainingSec,
  allowRegistration,
}: LoginModeContentProps) => {
  if (mode === 'signin' && signinStep === 'phone') {
    return (
      <SigninPhoneForm
        copy={copy}
        isRtl={isRtl}
        selectedCountry={selectedCountry}
        formattedNationalPhone={formattedNationalPhone}
        countryPickerOpen={countryPickerOpen}
        setCountryPickerOpen={setCountryPickerOpen}
        countryPickerRef={countryPickerRef}
        onCountryChange={onCountryChange}
        onPhoneInputChange={onPhoneInputChange}
        onSubmit={onSigninPhoneContinue}
        primaryBtnClass={primaryBtnClass}
        busy={busyAction === 'signin-phone-continue'}
      />
    );
  }

  if (mode === 'signin' && signinStep === 'password') {
    return (
      <SigninPasswordForm
        copy={copy}
        password={password}
        setPassword={setPassword}
        onSubmit={onSigninPasswordSubmit}
        onUseOtp={onUseOtp}
        onBack={onEnterSigninPhoneStep}
        primaryBtnClass={primaryBtnClass}
        secondaryBtnClass={secondaryBtnClass}
        busyPasswordSubmit={busyAction === 'signin-password-submit'}
        busyOtpSend={busyAction === 'signin-otp-send'}
      />
    );
  }

  if (mode === 'signin' && signinStep === 'otp') {
    return (
      <SigninOtpForm
        copy={copy}
        digits={signinOtpDigits}
        refs={signinOtpRefs}
        onDigitChange={onSigninDigitChange}
        onKeyDown={onSigninKeyDown}
        onPaste={onSigninPaste}
        onSubmit={onSigninOtpVerify}
        onBack={onResetSignin}
        onResend={onResendSigninOtp}
        primaryBtnClass={primaryBtnClass}
        secondaryBtnClass={secondaryBtnClass}
        busyVerify={busyAction === 'signin-otp-verify'}
        busySend={busyAction === 'signin-otp-send'}
        resendRemainingSec={resendRemainingSec}
      />
    );
  }

  if (mode === 'signin' && signinStep === 'twofactor') {
    return (
      <SigninTwoFactorForm
        copy={copy}
        digits={signinOtpDigits}
        refs={signinOtpRefs}
        onDigitChange={onSigninDigitChange}
        onKeyDown={onSigninKeyDown}
        onPaste={onSigninPaste}
        onSubmit={onSigninTwoFactorVerify}
        onBack={onResetSignin}
        primaryBtnClass={primaryBtnClass}
        secondaryBtnClass={secondaryBtnClass}
        busyVerify={busyAction === 'signin-2fa-verify'}
      />
    );
  }

  if (mode === 'signup' && signupStep === 'phone') {
    return (
      <SignupPhoneForm
        copy={copy}
        isRtl={isRtl}
        selectedCountry={selectedCountry}
        formattedNationalPhone={formattedNationalPhone}
        countryPickerOpen={countryPickerOpen}
        setCountryPickerOpen={setCountryPickerOpen}
        countryPickerRef={countryPickerRef}
        onCountryChange={onCountryChange}
        onPhoneInputChange={onPhoneInputChange}
        onSubmit={onSignupPhoneSubmit}
        primaryBtnClass={primaryBtnClass}
        allowRegistration={allowRegistration}
        busy={busyAction === 'signup-otp-send'}
      />
    );
  }

  if (mode === 'signup' && signupStep === 'otp') {
    return (
      <SignupOtpForm
        copy={copy}
        digits={signupOtpDigits}
        refs={signupOtpRefs}
        onDigitChange={onSignupDigitChange}
        onKeyDown={onSignupKeyDown}
        onPaste={onSignupPaste}
        onSubmit={onSignupOtpVerify}
        onBack={onResetSignup}
        onResend={onResendSignupOtp}
        primaryBtnClass={primaryBtnClass}
        secondaryBtnClass={secondaryBtnClass}
        busyVerify={busyAction === 'signup-otp-verify'}
        busySend={busyAction === 'signup-otp-send'}
        resendRemainingSec={resendRemainingSec}
      />
    );
  }

  return null;
};
