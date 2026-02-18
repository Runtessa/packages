import { ProfileCopy } from './types';

type DataPrivacySectionProps = {
  copy: ProfileCopy;
  cardClass: string;
};

export const DataPrivacySection = ({ copy, cardClass }: DataPrivacySectionProps) => {
  return (
    <section id="section-privacy" className={`${cardClass} w-full sm:w-[75%]`}>
      <div className="flex flex-col gap-4 rounded-[20px] border border-[#D2E3FC] bg-[#E8F0FE] p-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <h3 className="text-lg font-normal text-[#202124]">{copy.privacyCheckup}</h3>
          <p className="text-sm font-normal text-[#5F6368]">{copy.privacyCheckupHelp}</p>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[#1A73E8] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#DBE8FD] active:brightness-95"
          >
            {copy.takeCheckup}
          </button>
        </div>
        <div className="relative h-24 w-full overflow-hidden rounded-2xl bg-white/70 md:w-56">
          <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#1A73E8]/20" />
          <div className="absolute right-8 top-10 h-12 w-12 rounded-full bg-[#34A853]/20" />
          <div className="absolute left-6 bottom-2 h-10 w-10 rounded-full bg-[#FBBC04]/30" />
        </div>
      </div>
    </section>
  );
};
