import { LanguageToggle } from '../ui/LanguageToggle';
import { Mode, tabBaseClass } from './config';
import { LoginCopy } from './forms/types';
import { UiLocale } from '../../lib/ui/locale';

type LoginHeaderProps = {
  copy: LoginCopy;
  mode: Mode;
  loginTitle: string;
  tenantName: string;
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  onSelectSignin: () => void;
  onSelectSignup: () => void;
};

export const LoginHeader = ({
  copy,
  mode,
  loginTitle,
  tenantName,
  locale,
  setLocale,
  onSelectSignin,
  onSelectSignup,
}: LoginHeaderProps) => {
  return (
    <>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#5F6368]">
          {mode === 'signup' ? copy.signUp : copy.signIn}
        </p>
        <h1 className="mt-1 text-[28px] font-normal text-[#202124]">
          {mode === 'signup' ? copy.createAccount : loginTitle}
        </h1>
        <p className="mt-2 text-sm text-[#5F6368]">{mode === 'signup' ? copy.startWithPhone : copy.welcomeBack}</p>
      </div>

      <div className="mt-6 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-[#DADCE0] bg-white p-1">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onSelectSignin}
              className={`${tabBaseClass} ${
                mode === 'signin' ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
              }`}
            >
              {copy.signIn}
            </button>
            <button
              type="button"
              onClick={onSelectSignup}
              className={`${tabBaseClass} ${
                mode === 'signup' ? 'bg-[#E8F0FE] text-[#1A73E8]' : 'text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]'
              }`}
            >
              {copy.signUp}
            </button>
          </div>
          <span className="mx-1 h-5 w-px bg-[#E8EAED]" aria-hidden />
          <LanguageToggle locale={locale} onChange={setLocale} variant="inline" />
        </div>
      </div>

      {tenantName ? (
        <div className="mt-2 flex justify-center">
          <span className="inline-flex items-center rounded-full bg-[#E8F0FE] px-3 py-1 text-xs font-medium text-[#1A73E8]">
            {copy.tenant}: {tenantName}
          </span>
        </div>
      ) : null}
    </>
  );
};
