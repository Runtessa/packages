import { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react';

type OtpInputsProps = {
  baseId: string;
  digits: string[];
  refs: MutableRefObject<Array<HTMLInputElement | null>>;
  onDigitChange: (index: number, value: string) => void;
  onKeyDown: (index: number, event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
};

export const OtpInputs = ({
  baseId,
  digits,
  refs,
  onDigitChange,
  onKeyDown,
  onPaste,
}: OtpInputsProps) => {
  return (
    <div className="flex items-center justify-center gap-2" dir="ltr">
      {digits.map((digit, index) => (
        <input
          key={`${baseId}-${index}`}
          ref={(node) => {
            refs.current[index] = node;
          }}
          id={`${baseId}-${index}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]"
          maxLength={1}
          className="h-12 w-12 rounded-xl border border-[#DADCE0] bg-white text-center text-lg font-medium text-[#202124] outline-none transition-all duration-200 focus:border-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8]/20"
          value={digit}
          onChange={(event) => onDigitChange(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={onPaste}
        />
      ))}
    </div>
  );
};
