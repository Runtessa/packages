import Link from 'next/link';
import { ProfileCopy } from './types';

type SignedOutSectionProps = {
  copy: ProfileCopy;
  cardClass: string;
  secondaryBtnClass: string;
};

export const SignedOutSection = ({ copy, cardClass, secondaryBtnClass }: SignedOutSectionProps) => {
  return (
    <div className={cardClass}>
      <p className="text-sm font-normal text-[#5F6368]">{copy.signedOut}</p>
      <Link href="/login" className={`${secondaryBtnClass} mt-4`}>
        {copy.goToLogin}
      </Link>
    </div>
  );
};
