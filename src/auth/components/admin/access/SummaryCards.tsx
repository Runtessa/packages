import { AccessCopy } from './types';

type SummaryCardsProps = {
  copy: AccessCopy;
  cardClass: string;
  loading: boolean;
  loadingUsers: boolean;
  organizationsCount: number;
  rolesCount: number;
  mappedTenantsCount: number;
  usersTotal: number;
};

export const SummaryCards = ({
  copy,
  cardClass,
  loading,
  loadingUsers,
  organizationsCount,
  rolesCount,
  mappedTenantsCount,
  usersTotal,
}: SummaryCardsProps) => {
  return (
    <section className="grid w-full grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
      <article className={cardClass}>
        <h2 className="text-base font-normal text-[#202124]">{copy.summary.organizations}</h2>
        <p className="mt-2 text-sm text-[#5F6368]">{loading ? '...' : organizationsCount}</p>
      </article>
      <article className={cardClass}>
        <h2 className="text-base font-normal text-[#202124]">{copy.summary.roles}</h2>
        <p className="mt-2 text-sm text-[#5F6368]">{loading ? '...' : rolesCount}</p>
      </article>
      <article className={cardClass}>
        <h2 className="text-base font-normal text-[#202124]">{copy.summary.mappedTenants}</h2>
        <p className="mt-2 text-sm text-[#5F6368]">{loading ? '...' : mappedTenantsCount}</p>
      </article>
      <article className={cardClass}>
        <h2 className="text-base font-normal text-[#202124]">{copy.summary.totalUsers}</h2>
        <p className="mt-2 text-sm text-[#5F6368]">{loadingUsers ? '...' : usersTotal}</p>
      </article>
    </section>
  );
};
