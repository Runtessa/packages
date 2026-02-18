import { FormEvent, RefObject } from 'react';
import { PhoneInput } from '../PhoneInput';
import { CountryOption } from '../config';
import { LoginCopy } from './types';

type SignupPhoneFormProps = {
  copy: LoginCopy;
  isRtl: boolean;
  selectedCountry: CountryOption;
  formattedNationalPhone: string;
  countryPickerOpen: boolean;
  setCountryPickerOpen: (open: boolean) => void;
  countryPickerRef: RefObject<HTMLDivElement | null>;
  onCountryChange: (nextCode: string) => void;
  onPhoneInputChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  primaryBtnClass: string;
  allowRegistration: boolean;
  busy: boolean;
};

export const SignupPhoneForm = ({
  copy,
  isRtl,
  selectedCountry,
  formattedNationalPhone,
  countryPickerOpen,
  setCountryPickerOpen,
  countryPickerRef,
  onCountryChange,
  onPhoneInputChange,
  onSubmit,
  primaryBtnClass,
  allowRegistration,
  busy,
}: SignupPhoneFormProps) => {
  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-[360px] space-y-4">
      <fieldset disabled={!allowRegistration}>
        <PhoneInput
          fieldId="signup_phone"
          isRtl={isRtl}
          selectedCountry={selectedCountry}
          formattedNationalPhone={formattedNationalPhone}
          countryPickerOpen={countryPickerOpen}
          setCountryPickerOpen={setCountryPickerOpen}
          countryPickerRef={countryPickerRef}
          onCountryChange={onCountryChange}
          onPhoneInputChange={onPhoneInputChange}
          countryNames={copy.countryNames}
          phoneLabel={copy.phoneNumber}
        />
      </fieldset>
      <div className="flex items-center justify-center gap-3 pt-2">
        <button type="submit" className={primaryBtnClass} disabled={!allowRegistration || busy}>
          {busy ? copy.sendingCode : copy.sendVerificationCode}
        </button>
      </div>
    </form>
  );
};
