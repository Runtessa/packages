import { FormEvent } from 'react';
import { inputClass, inlineLinkClass } from '../config';
import { LoginCopy } from './types';

type SigninPasswordFormProps = {
  copy: LoginCopy;
  password: string;
  setPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onUseOtp: () => void;
  onBack: () => void;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  busyPasswordSubmit: boolean;
  busyOtpSend: boolean;
};

export const SigninPasswordForm = ({
  copy,
  password,
  setPassword,
  onSubmit,
  onUseOtp,
  onBack,
  primaryBtnClass,
  secondaryBtnClass,
  busyPasswordSubmit,
  busyOtpSend,
}: SigninPasswordFormProps) => {
  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-[360px] space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm font-normal text-[#202124]" htmlFor="signin_password">
            {copy.password}
          </label>
          <button type="button" className={inlineLinkClass} onClick={onUseOtp} disabled={busyOtpSend}>
            {busyOtpSend ? copy.sendingCode : copy.loginWithVerificationCode}
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
        <button type="submit" className={primaryBtnClass} disabled={busyPasswordSubmit}>
          {busyPasswordSubmit ? copy.signingIn : copy.signIn}
        </button>
        <button type="button" className={secondaryBtnClass} onClick={onBack}>
          {copy.changePhone}
        </button>
      </div>
    </form>
  );
};
