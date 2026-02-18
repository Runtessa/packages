import { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { ContactInfoSection } from './sections/ContactInfoSection';
import { DataPrivacySection } from './sections/DataPrivacySection';
import { HomeSection } from './sections/HomeSection';
import { PersonalInfoSection } from './sections/PersonalInfoSection';
import { SecuritySection } from './sections/SecuritySection';
import { SignedOutSection } from './sections/SignedOutSection';
import { TwoFactorSection } from './sections/TwoFactorSection';
import {
  ProfileDetailsFormState,
  ProfilePasswordFormState,
  ProfilePayload,
  RailKey,
  SessionPayload,
  TwoFactorSetupState,
} from './config';
import { AuthMessages } from '../../lib/ui/i18n';

interface ProfileSectionContentProps {
  copy: AuthMessages['profile'];
  session: SessionPayload | null;
  profile: ProfilePayload['profile'] | null;
  loading: boolean;
  activeRail: RailKey;
  profileAvatar: string;
  avatarInitials: string;
  cardClass: string;
  inputClass: string;
  primaryBtnClass: string;
  secondaryBtnClass: string;
  isRtl: boolean;
  detailsSaving: boolean;
  passwordSaving: boolean;
  twoFaSaving: boolean;
  detailsForm: ProfileDetailsFormState;
  setDetailsForm: Dispatch<SetStateAction<ProfileDetailsFormState>>;
  passwordForm: ProfilePasswordFormState;
  setPasswordForm: Dispatch<SetStateAction<ProfilePasswordFormState>>;
  twoFaCode: string;
  setTwoFaCode: React.Dispatch<React.SetStateAction<string>>;
  twoFaSetup: TwoFactorSetupState | null;
  twoFaQrDataUrl: string;
  twoFaQrLoading: boolean;
  twoFaQrError: string;
  birthdayPickerRef: RefObject<HTMLDivElement | null>;
  birthdayPickerOpen: boolean;
  birthdayDisplay: string;
  birthdayMonth: Date;
  calendarMonthOptions: Array<{ value: number; label: string }>;
  birthdayYearOptions: number[];
  monthLabelFormatter: Intl.DateTimeFormat;
  calendarWeekdays: readonly string[];
  birthdayCells: Array<Date | null>;
  selectedBirthday: Date | null;
  today: Date;
  onAvatarClick: () => void;
  onSaveDetails: (event: FormEvent) => Promise<void>;
  onChangePassword: (event: FormEvent) => Promise<void>;
  onGenerateTwoFactorSetup: () => Promise<void>;
  onEnableTwoFactor: (event: FormEvent) => Promise<void>;
  onDisableTwoFactor: () => Promise<void>;
  onToggleBirthdayPicker: () => void;
  onSetBirthdayPickerOpen: Dispatch<SetStateAction<boolean>>;
  onSetBirthdayMonthValue: (month: number) => void;
  onSetBirthdayYearValue: (year: number) => void;
  onChangeBirthdayMonth: (delta: number) => void;
  onSelectBirthday: (value: Date) => void;
}

export const ProfileSectionContent = ({
  copy,
  session,
  profile,
  loading,
  activeRail,
  profileAvatar,
  avatarInitials,
  cardClass,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
  isRtl,
  detailsSaving,
  passwordSaving,
  twoFaSaving,
  detailsForm,
  setDetailsForm,
  passwordForm,
  setPasswordForm,
  twoFaCode,
  setTwoFaCode,
  twoFaSetup,
  twoFaQrDataUrl,
  twoFaQrLoading,
  twoFaQrError,
  birthdayPickerRef,
  birthdayPickerOpen,
  birthdayDisplay,
  birthdayMonth,
  calendarMonthOptions,
  birthdayYearOptions,
  monthLabelFormatter,
  calendarWeekdays,
  birthdayCells,
  selectedBirthday,
  today,
  onAvatarClick,
  onSaveDetails,
  onChangePassword,
  onGenerateTwoFactorSetup,
  onEnableTwoFactor,
  onDisableTwoFactor,
  onToggleBirthdayPicker,
  onSetBirthdayPickerOpen,
  onSetBirthdayMonthValue,
  onSetBirthdayYearValue,
  onChangeBirthdayMonth,
  onSelectBirthday,
}: ProfileSectionContentProps) => {
  if (loading) {
    return <div className={`${cardClass} text-sm text-[#5F6368]`}>{copy.loadingProfile}</div>;
  }

  if (!session?.authenticated || !session.user || !profile) {
    return <SignedOutSection copy={copy} cardClass={cardClass} secondaryBtnClass={secondaryBtnClass} />;
  }

  return (
    <>
      {activeRail === 'home' ? (
        <HomeSection
          copy={copy}
          profile={profile}
          profileAvatar={profileAvatar}
          avatarInitials={avatarInitials}
          cardClass={cardClass}
          secondaryBtnClass={secondaryBtnClass}
          isAuthAdmin={Boolean(session.user.isAuthAdmin)}
          onAvatarClick={onAvatarClick}
        />
      ) : null}

      {activeRail === 'contact-info' ? (
        <ContactInfoSection copy={copy} profile={profile} cardClass={cardClass} isRtl={isRtl} />
      ) : null}

      {activeRail === 'data-privacy' ? <DataPrivacySection copy={copy} cardClass={cardClass} /> : null}

      {activeRail === 'security' ? (
        <SecuritySection
          copy={copy}
          profile={profile}
          cardClass={cardClass}
          inputClass={inputClass}
          primaryBtnClass={primaryBtnClass}
          passwordForm={passwordForm}
          setPasswordForm={setPasswordForm}
          passwordSaving={passwordSaving}
          onChangePassword={onChangePassword}
        />
      ) : null}

      {activeRail === 'personal-info' ? (
        <PersonalInfoSection
          copy={copy}
          profile={profile}
          isRtl={isRtl}
          cardClass={cardClass}
          inputClass={inputClass}
          primaryBtnClass={primaryBtnClass}
          detailsForm={detailsForm}
          setDetailsForm={setDetailsForm}
          detailsSaving={detailsSaving}
          onSaveDetails={onSaveDetails}
          onAvatarClick={onAvatarClick}
          birthdayPickerRef={birthdayPickerRef}
          birthdayPickerOpen={birthdayPickerOpen}
          birthdayDisplay={birthdayDisplay}
          birthdayMonth={birthdayMonth}
          calendarMonthOptions={calendarMonthOptions}
          birthdayYearOptions={birthdayYearOptions}
          monthLabelFormatter={monthLabelFormatter}
          calendarWeekdays={calendarWeekdays}
          birthdayCells={birthdayCells}
          selectedBirthday={selectedBirthday}
          today={today}
          onToggleBirthdayPicker={onToggleBirthdayPicker}
          onSetBirthdayPickerOpen={onSetBirthdayPickerOpen}
          onSetBirthdayMonthValue={onSetBirthdayMonthValue}
          onSetBirthdayYearValue={onSetBirthdayYearValue}
          onChangeBirthdayMonth={onChangeBirthdayMonth}
          onSelectBirthday={onSelectBirthday}
        />
      ) : null}

      {activeRail === 'two-factor' ? (
        <TwoFactorSection
          copy={copy}
          profile={profile}
          cardClass={cardClass}
          secondaryBtnClass={secondaryBtnClass}
          primaryBtnClass={primaryBtnClass}
          inputClass={inputClass}
          twoFaSaving={twoFaSaving}
          twoFaSetup={twoFaSetup}
          twoFaCode={twoFaCode}
          setTwoFaCode={setTwoFaCode}
          twoFaQrDataUrl={twoFaQrDataUrl}
          twoFaQrLoading={twoFaQrLoading}
          twoFaQrError={twoFaQrError}
          onGenerateSetup={onGenerateTwoFactorSetup}
          onEnable={onEnableTwoFactor}
          onDisable={onDisableTwoFactor}
        />
      ) : null}
    </>
  );
};
