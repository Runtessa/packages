import { ClipboardEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';
import { OtpInputs } from '../OtpInputs';
import { LoginCopy } from './types';

type SigninTwoFactorFormProps = {
  copy: LoginCopy;
  digits: string[];
  refs: MutableRefObject<Array<HTMLInputElement | null>>;
  onDigitChange: (index: number, value: string) => void;
  onKeyDown: (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  busyVerify: boolean;
};

export const SigninTwoFactorForm = ({
  copy,
  digits,
  refs,
  onDigitChange,
  onKeyDown,
  onPaste,
  onSubmit,
  onBack,
  primaryBtnClass,
  secondaryBtnClass,
  busyVerify,
}: SigninTwoFactorFormProps) => {
  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-[360px] space-y-4">
      <p className="text-center text-sm text-[#5F6368]">{copy.authenticatorPrompt}</p>
      <div>
        <OtpInputs
          baseId="signin-twofactor"
          digits={digits}
          refs={refs}
          onDigitChange={onDigitChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
      <div className="flex items-center justify-center gap-3 pt-2">
        <button type="submit" className={primaryBtnClass} disabled={busyVerify}>
          {busyVerify ? copy.verifying : copy.verify}
        </button>
        <button type="button" className={secondaryBtnClass} onClick={onBack}>
          {copy.back}
        </button>
      </div>
    </form>
  );
};
