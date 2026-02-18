import { ClipboardEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';
import { OtpInputs } from '../OtpInputs';
import { formatCountdown, tinyLinkClass } from '../config';
import { LoginCopy } from './types';

type SignupOtpFormProps = {
  copy: LoginCopy;
  digits: string[];
  refs: MutableRefObject<Array<HTMLInputElement | null>>;
  onDigitChange: (index: number, value: string) => void;
  onKeyDown: (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
  onResend: () => void;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  busyVerify: boolean;
  busySend: boolean;
  resendRemainingSec: number;
};

export const SignupOtpForm = ({
  copy,
  digits,
  refs,
  onDigitChange,
  onKeyDown,
  onPaste,
  onSubmit,
  onBack,
  onResend,
  primaryBtnClass,
  secondaryBtnClass,
  busyVerify,
  busySend,
  resendRemainingSec,
}: SignupOtpFormProps) => {
  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-[360px] space-y-4">
      <div>
        <OtpInputs
          baseId="signup-otp"
          digits={digits}
          refs={refs}
          onDigitChange={onDigitChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
      <div className="flex items-center justify-center gap-3 pt-2">
        <button type="submit" className={primaryBtnClass} disabled={busyVerify}>
          {busyVerify ? copy.verifying : copy.completeSignUp}
        </button>
        <button type="button" className={secondaryBtnClass} onClick={onBack}>
          {copy.back}
        </button>
      </div>
      <div className="text-center">
        <button type="button" className={tinyLinkClass} disabled={resendRemainingSec > 0 || busySend} onClick={onResend}>
          {resendRemainingSec > 0
            ? copy.sendSmsAgainIn.replace('{time}', formatCountdown(resendRemainingSec))
            : busySend
              ? copy.sendingCode
              : copy.sendSmsAgain}
        </button>
      </div>
    </form>
  );
};
