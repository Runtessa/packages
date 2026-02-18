import { infoRow } from '../config';
import { ProfileCopy, ProfileState } from './types';

type ContactInfoSectionProps = {
  copy: ProfileCopy;
  profile: ProfileState;
  cardClass: string;
  isRtl: boolean;
};

export const ContactInfoSection = ({ copy, profile, cardClass, isRtl }: ContactInfoSectionProps) => {
  return (
    <section id="section-contact-info" className="grid w-full grid-cols-1 gap-6 sm:w-[75%]">
      <article className={cardClass}>
        <h2 className="text-xl font-normal text-[#202124]">{copy.contactInfo}</h2>
        <div className="mt-4 divide-y divide-[#E8EAED]">
          {infoRow(copy.primaryEmail, profile.user.email || copy.notSet, undefined, isRtl)}
          {infoRow(copy.recoveryEmail, copy.notSet, undefined, isRtl)}
          {infoRow(copy.phoneNumber, profile.user.phoneNumber || copy.notSet, undefined, isRtl)}
        </div>
      </article>
    </section>
  );
};
