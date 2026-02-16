import Head from 'next/head';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { localeDir, useUiLocale } from '../../lib/ui/locale';
import { getAuthMessages } from '../../lib/ui/i18n';

interface SessionPayload {
  authenticated: boolean;
  user?: {
    email: string;
    firstName: string;
    lastName: string;
  };
}

interface WhitelistResponse {
  items?: Array<{ isActive: boolean }>;
  error?: string;
}

const cardClass = 'rounded-[24px] p-6';
const primaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#1765cc] active:brightness-95';
const secondaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#F6F9FE] active:brightness-95';

export default function AuthAdminDashboardPage() {
  const { locale, isRtl } = useUiLocale();
  const copy = getAuthMessages(locale).dashboard;
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [totalTenants, setTotalTenants] = useState(0);
  const [activeTenants, setActiveTenants] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');

      try {
        const sessionRes = await fetch('/api/session', { credentials: 'include' });
        const sessionData = (await sessionRes.json()) as SessionPayload;
        setSession(sessionData);

        if (!sessionData.authenticated) {
          setError(copy.authenticationRequired);
          return;
        }

        const listRes = await fetch('/api/admin/tenant-whitelist', { credentials: 'include' });
        const listData = (await listRes.json()) as WhitelistResponse;
        if (!listRes.ok) {
          throw new Error(listData.error || copy.loadTenantFailed);
        }

        const items = listData.items || [];
        setTotalTenants(items.length);
        setActiveTenants(items.filter((item) => item.isActive).length);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : copy.unexpectedError);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [copy.authenticationRequired, copy.loadTenantFailed, copy.unexpectedError]);

  return (
    <>
      <Head>
        <title>{copy.headTitle}</title>
      </Head>

      <div className="space-y-6" dir={localeDir(locale)}>
        <PageHeader
          title={copy.title}
          subtitle={copy.subtitle}
          align={isRtl ? 'right' : 'left'}
          actions={
            <div className="flex flex-wrap gap-2">
              <a href="/profile" className={secondaryBtnClass}>
                {copy.backToProfile}
              </a>
              <a href="/admin/tenants" className={primaryBtnClass}>
                {copy.openTenantPanel}
              </a>
            </div>
          }
        />

        {error ? <div className="rounded-xl border border-[#F28B82] bg-[#FDECEA] px-4 py-3 text-sm text-[#B3261E]">{error}</div> : null}
        <div className="section-separator" />

        <section className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.overview}</h2>
            <div className="mt-4 space-y-3 text-sm text-[#5F6368]">
              <p>
                <span className="font-normal text-[#202124]">{copy.authAdminUser}:</span>{' '}
                {session?.user?.email || copy.na}
              </p>
              <p>
                <span className="font-normal text-[#202124]">{copy.tenantWhitelistEntries}:</span>{' '}
                {loading ? '...' : totalTenants}
              </p>
              <p>
                <span className="font-normal text-[#202124]">{copy.activeTenants}:</span>{' '}
                {loading ? '...' : activeTenants}
              </p>
            </div>
          </article>

          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">{copy.quickActions}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href="/admin/tenants" className={primaryBtnClass}>
                {copy.manageTenantWhitelist}
              </a>
              <a href="/profile" className={secondaryBtnClass}>
                {copy.openProfile}
              </a>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}
