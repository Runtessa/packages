import Link from 'next/link';
import { FiCamera } from 'react-icons/fi';
import { formatDateTime } from '../config';
import { ProfileCopy, ProfileState } from './types';

type HomeSectionProps = {
  copy: ProfileCopy;
  profile: ProfileState;
  profileAvatar: string;
  avatarInitials: string;
  cardClass: string;
  secondaryBtnClass: string;
  isAuthAdmin: boolean;
  onAvatarClick: () => void;
};

export const HomeSection = ({
  copy,
  profile,
  profileAvatar,
  avatarInitials,
  cardClass,
  secondaryBtnClass,
  isAuthAdmin,
  onAvatarClick,
}: HomeSectionProps) => {
  return (
    <section id="section-hero" className={`${cardClass} w-full px-6 py-10 text-center sm:w-[75%]`}>
      <div className="relative mx-auto h-[120px] w-[120px]">
        <div className="flex h-[120px] w-[120px] items-center justify-center overflow-hidden rounded-full border border-[#DADCE0] bg-[#F1F3F4] text-3xl font-normal text-[#1A73E8]">
          {profileAvatar ? (
            <img src={profileAvatar} alt={copy.profileAvatar} className="h-full w-full object-cover" />
          ) : (
            avatarInitials
          )}
        </div>
        <button
          type="button"
          onClick={onAvatarClick}
          className="absolute bottom-1 right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#DADCE0] bg-white text-[#1A73E8] shadow-[0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)] transition-all duration-200 hover:bg-[#E8F0FE] active:brightness-95"
          aria-label={copy.changeAvatarAria}
        >
          <FiCamera className="h-4 w-4" />
        </button>
      </div>

      <h1 className="mt-5 text-[28px] font-normal text-[#202124]">
        {copy.welcome}، {profile.user.firstName}
      </h1>
      <p className="mx-auto mt-2 max-w-3xl text-sm font-normal text-[#5F6368]">{copy.welcomeSubtitle}</p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-[#5F6368]">
        <span className="rounded-full bg-[#F1F3F4] px-3 py-1">
          {copy.lastLogin}: {formatDateTime(profile.audit.lastLoginAt, copy.notSet)}
        </span>
        <span className="rounded-full bg-[#F1F3F4] px-3 py-1">
          {copy.lastSeen}: {formatDateTime(profile.audit.lastSeenAt, copy.notSet)}
        </span>
        <span className="max-w-full break-all rounded-full bg-[#F1F3F4] px-3 py-1">{profile.user.email}</span>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {isAuthAdmin ? (
          <Link href="/admin" className={secondaryBtnClass}>
            {copy.openAuthAdmin}
          </Link>
        ) : null}
      </div>
    </section>
  );
};
