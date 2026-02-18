import { FormEvent, RefObject } from 'react';
import { FiChevronRight } from 'react-icons/fi';
import { ProfileDetailsFormState, secondaryBtnClass } from '../config';
import { AssignmentTables } from './AssignmentTables';
import { BirthdayPickerField } from './BirthdayPickerField';
import { ProfileCopy, ProfileState } from './types';

type PersonalInfoSectionProps = {
  copy: ProfileCopy;
  profile: ProfileState;
  isRtl: boolean;
  cardClass: string;
  inputClass: string;
  primaryBtnClass: string;
  detailsForm: ProfileDetailsFormState;
  setDetailsForm: (updater: (prev: ProfileDetailsFormState) => ProfileDetailsFormState) => void;
  detailsSaving: boolean;
  onSaveDetails: (event: FormEvent) => void;
  onAvatarClick: () => void;
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
  onToggleBirthdayPicker: () => void;
  onSetBirthdayPickerOpen: (open: boolean) => void;
  onSetBirthdayMonthValue: (month: number) => void;
  onSetBirthdayYearValue: (year: number) => void;
  onChangeBirthdayMonth: (delta: number) => void;
  onSelectBirthday: (value: Date) => void;
};

export const PersonalInfoSection = ({
  copy,
  profile,
  isRtl,
  cardClass,
  inputClass,
  primaryBtnClass,
  detailsForm,
  setDetailsForm,
  detailsSaving,
  onSaveDetails,
  onAvatarClick,
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
  onToggleBirthdayPicker,
  onSetBirthdayPickerOpen,
  onSetBirthdayMonthValue,
  onSetBirthdayYearValue,
  onChangeBirthdayMonth,
  onSelectBirthday,
}: PersonalInfoSectionProps) => {
  return (
    <section id="section-personal-info-form" className="grid w-full grid-cols-1 gap-6 sm:w-[75%] xl:grid-cols-2">
      <article id="section-settings" className={`${cardClass} xl:col-span-2`}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.personalInfo}</h2>
        <form className="mt-4 space-y-4" onSubmit={onSaveDetails}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.firstName}</label>
              <input
                className={inputClass}
                value={detailsForm.firstName}
                onChange={(event) => setDetailsForm((prev) => ({ ...prev, firstName: event.target.value }))}
                placeholder={copy.placeholders.firstName}
                maxLength={120}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.lastName}</label>
              <input
                className={inputClass}
                value={detailsForm.lastName}
                onChange={(event) => setDetailsForm((prev) => ({ ...prev, lastName: event.target.value }))}
                placeholder={copy.placeholders.lastName}
                maxLength={120}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BirthdayPickerField
              copy={copy}
              inputClass={inputClass}
              isRtl={isRtl}
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
              onTogglePicker={onToggleBirthdayPicker}
              onSetPickerOpen={onSetBirthdayPickerOpen}
              onSetBirthdayMonthValue={onSetBirthdayMonthValue}
              onSetBirthdayYearValue={onSetBirthdayYearValue}
              onChangeBirthdayMonth={onChangeBirthdayMonth}
              onSelectBirthday={onSelectBirthday}
              onClearBirthday={() => {
                setDetailsForm((prev) => ({ ...prev, birthday: '' }));
                onSetBirthdayPickerOpen(false);
              }}
            />

            <div>
              <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.gender}</label>
              <div className="relative">
                <select
                  className={`${inputClass} appearance-none pr-10`}
                  value={detailsForm.gender}
                  onChange={(event) => setDetailsForm((prev) => ({ ...prev, gender: event.target.value }))}
                >
                  {copy.genderOptions.map((option) => (
                    <option key={option.value || 'empty'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FiChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-[#5F6368]" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.nationalId}</label>
              <input
                className={`${inputClass} text-left`}
                dir="ltr"
                value={detailsForm.nationalId}
                onChange={(event) => setDetailsForm((prev) => ({ ...prev, nationalId: event.target.value }))}
                placeholder={copy.placeholders.nationalId}
                maxLength={96}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.phoneNumber}</label>
              <input
                className={`${inputClass} text-left`}
                dir="ltr"
                value={detailsForm.phoneNumber}
                onChange={(event) => setDetailsForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                placeholder={copy.placeholders.phoneNumber}
                maxLength={32}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.profileAvatar}</label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={secondaryBtnClass} onClick={onAvatarClick}>
                {copy.uploadAvatar}
              </button>
              {detailsForm.avatarUrl ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-[#DADCE0] px-4 py-2 text-sm font-medium text-[#5F6368] transition-all duration-200 hover:bg-[#F1F3F4]"
                  onClick={() => setDetailsForm((prev) => ({ ...prev, avatarUrl: '' }))}
                >
                  {copy.removeAvatar}
                </button>
              ) : null}
            </div>
            <p className="text-xs text-[#5F6368]">{copy.avatarHint}</p>
          </div>

          <button type="submit" className={primaryBtnClass} disabled={detailsSaving}>
            {detailsSaving ? copy.updating : copy.saveProfileDetails}
          </button>
        </form>
      </article>

      <AssignmentTables copy={copy} profile={profile} cardClass={cardClass} isRtl={isRtl} />
    </section>
  );
};
