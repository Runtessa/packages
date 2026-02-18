import { FormEvent } from 'react';
import { ProfilePasswordFormState, formatDateTime } from '../config';
import { ProfileCopy, ProfileState } from './types';

type SecuritySectionProps = {
  copy: ProfileCopy;
  profile: ProfileState;
  cardClass: string;
  inputClass: string;
  primaryBtnClass: string;
  passwordForm: ProfilePasswordFormState;
  setPasswordForm: (updater: (prev: ProfilePasswordFormState) => ProfilePasswordFormState) => void;
  passwordSaving: boolean;
  onChangePassword: (event: FormEvent) => void;
};

export const SecuritySection = ({
  copy,
  profile,
  cardClass,
  inputClass,
  primaryBtnClass,
  passwordForm,
  setPasswordForm,
  passwordSaving,
  onChangePassword,
}: SecuritySectionProps) => {
  return (
    <section id="section-security" className="grid w-full grid-cols-1 gap-6 sm:w-[75%] xl:grid-cols-2">
      <article className={cardClass}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.passwordSettings}</h2>
        <form className="mt-4 space-y-4" onSubmit={onChangePassword}>
          {profile.security.hasPassword ? (
            <div>
              <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.currentPassword}</label>
              <input
                type="password"
                className={`${inputClass} text-left`}
                dir="ltr"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                autoComplete="current-password"
                required
              />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.newPassword}</label>
            <input
              type="password"
              className={`${inputClass} text-left`}
              dir="ltr"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-normal text-[#202124]">{copy.confirmNewPassword}</label>
            <input
              type="password"
              className={`${inputClass} text-left`}
              dir="ltr"
              value={passwordForm.confirmPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>

          <button type="submit" className={primaryBtnClass} disabled={passwordSaving}>
            {passwordSaving ? copy.updating : profile.security.hasPassword ? copy.updatePassword : copy.setPassword}
          </button>
        </form>
      </article>

      <article className={cardClass}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.lastLoginSession}</h2>
        <div className="mt-4 space-y-3 text-sm text-[#5F6368]">
          <p>
            <span className="font-normal text-[#202124]">{copy.lastLogin}:</span>{' '}
            {formatDateTime(profile.audit.lastLoginAt, copy.notSet)}
          </p>
          <p>
            <span className="font-normal text-[#202124]">{copy.ipAddress}:</span>{' '}
            {profile.audit.lastLoginIp || copy.notSet}
          </p>
          <p>
            <span className="font-normal text-[#202124]">{copy.userAgent}:</span>{' '}
            {profile.audit.lastLoginUserAgent || copy.notSet}
          </p>
          <p>
            <span className="font-normal text-[#202124]">{copy.lastSeen}:</span>{' '}
            {formatDateTime(profile.audit.lastSeenAt, copy.notSet)}
          </p>
        </div>
      </article>
    </section>
  );
};
