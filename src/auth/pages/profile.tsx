import Head from 'next/head';
import { useMemo, useRef } from 'react';
import { LanguageToggle } from '../components/ui/LanguageToggle';
import { MobileBottomNav } from '../components/profile/MobileBottomNav';
import { ProfileSectionContent } from '../components/profile/ProfileSectionContent';
import { SidebarNav } from '../components/profile/SidebarNav';
import { ToastStack } from '../components/profile/ToastStack';
import { useBirthdayPicker } from '../components/profile/hooks/useBirthdayPicker';
import { useOutsideDismiss } from '../components/profile/hooks/useOutsideDismiss';
import { useProfileData } from '../components/profile/hooks/useProfileData';
import { useProfileNavigation } from '../components/profile/hooks/useProfileNavigation';
import { useProfileToasts } from '../components/profile/hooks/useProfileToasts';
import { localeDir, useUiLocale } from '../lib/ui/locale';
import { getAuthMessages } from '../lib/ui/i18n';
import {
  cardClass,
  desktopRailLeft,
  initialsFrom,
  inputClass,
  primaryBtnClass,
  secondaryBtnClass,
} from '../components/profile/config';

export default function ProfilePage() {
  const { locale, isRtl, setLocale } = useUiLocale();
  const copy = getAuthMessages(locale).profile;
  const { toasts, pushToast } = useProfileToasts();

  const {
    session,
    profile,
    loading,
    csrfToken,
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
    handleAvatarFileChange,
    logout,
    handleSaveDetails,
    handleChangePassword,
    handleGenerateTwoFactorSetup,
    handleEnableTwoFactor,
    handleDisableTwoFactor,
  } = useProfileData({ copy, pushToast });

  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    activeRail,
    mobileMenuOpen,
    setMobileMenuOpen,
    mobileMenuRef,
    mobileBeforeHomeItems,
    mobileAfterHomeItems,
    mobileHomeItem,
    mobileOverflowItems,
    mobileMoreActive,
    railLabels,
    handleSectionNav,
    closeMobileMenu,
    handleLogout,
    toggleCornerClass,
  } = useProfileNavigation({
    copy,
    isRtl,
    logout,
  });

  const {
    birthdayPickerOpen,
    setBirthdayPickerOpen,
    birthdayMonth,
    birthdayPickerRef,
    monthLabelFormatter,
    calendarMonthOptions,
    selectedBirthday,
    birthdayCells,
    today,
    birthdayYearOptions,
    birthdayDisplay,
    calendarWeekdays,
    closeBirthdayPicker,
    toggleBirthdayPicker,
    changeBirthdayMonth,
    setBirthdayMonthValue,
    setBirthdayYearValue,
    selectBirthday,
  } = useBirthdayPicker({
    copy,
    birthdayValue: detailsForm.birthday,
    setDetailsForm,
  });

  const profileAvatar = detailsForm.avatarUrl || profile?.user.avatarUrl || '';
  const avatarInitials = useMemo(() => {
    if (!profile) return 'U';
    return initialsFrom(profile.user.firstName, profile.user.lastName);
  }, [profile]);

  const handleAvatarFabClick = () => {
    avatarFileInputRef.current?.click();
  };

  useOutsideDismiss(mobileMenuOpen, mobileMenuRef, closeMobileMenu);
  useOutsideDismiss(birthdayPickerOpen, birthdayPickerRef, closeBirthdayPicker);

  return (
    <>
      <Head>
        <title>{copy.title}</title>
      </Head>

      <main className="min-h-screen overflow-x-hidden bg-[#F6F8FC] pb-20 pt-6 text-[#202124] md:pb-8" dir={localeDir(locale)}>
        <ToastStack toasts={toasts} />

        <div className={`fixed top-4 z-[60] ${toggleCornerClass}`}>
          <LanguageToggle locale={locale} onChange={setLocale} />
        </div>

        <div className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-[1400px] items-stretch gap-6 px-3 sm:px-4">
          <SidebarNav
            activeRail={activeRail}
            railLabels={railLabels}
            onSelect={handleSectionNav}
            onLogout={handleLogout}
            isRtl={isRtl}
            cardClass={cardClass}
            desktopRailLeft={desktopRailLeft}
            logoutLabel={copy.nav.logout}
          />

          <section className="min-w-0 flex w-full max-w-full flex-1 flex-col justify-center gap-6">
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="hidden"
              onChange={handleAvatarFileChange}
            />

            <div className="flex w-full flex-1 items-center justify-center">
              <ProfileSectionContent
                copy={copy}
                session={session}
                profile={profile}
                loading={loading}
                activeRail={activeRail}
                profileAvatar={profileAvatar}
                avatarInitials={avatarInitials}
                cardClass={cardClass}
                inputClass={inputClass}
                primaryBtnClass={primaryBtnClass}
                secondaryBtnClass={secondaryBtnClass}
                isRtl={isRtl}
                detailsSaving={detailsSaving}
                passwordSaving={passwordSaving}
                twoFaSaving={twoFaSaving}
                detailsForm={detailsForm}
                setDetailsForm={setDetailsForm}
                passwordForm={passwordForm}
                setPasswordForm={setPasswordForm}
                twoFaCode={twoFaCode}
                setTwoFaCode={setTwoFaCode}
                twoFaSetup={twoFaSetup}
                twoFaQrDataUrl={twoFaQrDataUrl}
                twoFaQrLoading={twoFaQrLoading}
                twoFaQrError={twoFaQrError}
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
                onAvatarClick={handleAvatarFabClick}
                onSaveDetails={handleSaveDetails}
                onChangePassword={handleChangePassword}
                onGenerateTwoFactorSetup={handleGenerateTwoFactorSetup}
                onEnableTwoFactor={handleEnableTwoFactor}
                onDisableTwoFactor={handleDisableTwoFactor}
                onToggleBirthdayPicker={toggleBirthdayPicker}
                onSetBirthdayPickerOpen={setBirthdayPickerOpen}
                onSetBirthdayMonthValue={setBirthdayMonthValue}
                onSetBirthdayYearValue={setBirthdayYearValue}
                onChangeBirthdayMonth={changeBirthdayMonth}
                onSelectBirthday={selectBirthday}
              />
            </div>
          </section>
        </div>

        <MobileBottomNav
          dir={localeDir(locale)}
          activeRail={activeRail}
          railLabels={railLabels}
          mobileBeforeHomeItems={mobileBeforeHomeItems}
          mobileAfterHomeItems={mobileAfterHomeItems}
          mobileHomeItem={mobileHomeItem}
          mobileOverflowItems={mobileOverflowItems}
          mobileMenuRef={mobileMenuRef}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
          mobileMoreActive={mobileMoreActive}
          onSelect={handleSectionNav}
          onLogout={handleLogout}
          isRtl={isRtl}
          moreLabel={copy.more}
          logoutLabel={copy.nav.logout}
        />
      </main>
    </>
  );
}
