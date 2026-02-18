import { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, useRef, useState } from 'react';
import { OtpContext } from '../config';

export const useOtpInputs = () => {
  const [signinOtpDigits, setSigninOtpDigits] = useState<string[]>(Array(6).fill(''));
  const [signupOtpDigits, setSignupOtpDigits] = useState<string[]>(Array(6).fill(''));
  const signinOtpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const signupOtpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const clearOtpDigits = (context: OtpContext) => {
    const empty = Array(6).fill('');
    if (context === 'signin') setSigninOtpDigits(empty);
    else setSignupOtpDigits(empty);
  };

  const otpCodeFor = (context: OtpContext): string => (context === 'signin' ? signinOtpDigits : signupOtpDigits).join('');

  const refsFor = (context: OtpContext): MutableRefObject<Array<HTMLInputElement | null>> =>
    context === 'signin' ? signinOtpRefs : signupOtpRefs;

  const setDigitsFor = (context: OtpContext, next: string[]) => {
    if (context === 'signin') setSigninOtpDigits(next);
    else setSignupOtpDigits(next);
  };

  const handleOtpDigitChange = (context: OtpContext, index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const current = context === 'signin' ? signinOtpDigits : signupOtpDigits;
    const next = [...current];
    next[index] = digit;
    setDigitsFor(context, next);
    if (digit && index < 5) {
      refsFor(context).current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (context: OtpContext, index: number, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      const current = context === 'signin' ? signinOtpDigits : signupOtpDigits;
      if (!current[index] && index > 0) {
        refsFor(context).current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      refsFor(context).current[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowRight' && index < 5) {
      refsFor(context).current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (context: OtpContext, event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    const next = Array(6)
      .fill('')
      .map((_, idx) => pasted[idx] || '');
    setDigitsFor(context, next);
    const targetIndex = Math.min(pasted.length, 5);
    refsFor(context).current[targetIndex]?.focus();
  };

  return {
    signinOtpDigits,
    signupOtpDigits,
    signinOtpRefs,
    signupOtpRefs,
    clearOtpDigits,
    otpCodeFor,
    handleOtpDigitChange,
    handleOtpKeyDown,
    handleOtpPaste,
  };
};

export type OtpInputsState = ReturnType<typeof useOtpInputs>;
