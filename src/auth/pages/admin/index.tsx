import Head from 'next/head';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';

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
          setError('Authentication required');
          return;
        }

        const listRes = await fetch('/api/admin/tenant-whitelist', { credentials: 'include' });
        const listData = (await listRes.json()) as WhitelistResponse;
        if (!listRes.ok) {
          throw new Error(listData.error || 'Failed to load tenant whitelist');
        }

        const items = listData.items || [];
        setTotalTenants(items.length);
        setActiveTenants(items.filter((item) => item.isActive).length);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unexpected error');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <>
      <Head>
        <title>Auth Admin | Dashboard</title>
      </Head>

      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          subtitle="Tenant SSO administration and security controls."
          actions={
            <div className="flex flex-wrap gap-2">
              <a href="/profile" className={secondaryBtnClass}>
                Back to profile
              </a>
              <a href="/admin/tenants" className={primaryBtnClass}>
                Open tenant panel
              </a>
            </div>
          }
        />

        {error ? <div className="rounded-xl border border-[#F28B82] bg-[#FDECEA] px-4 py-3 text-sm text-[#B3261E]">{error}</div> : null}

        <section className="grid w-full grid-cols-1 gap-6 xl:grid-cols-2">
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">Overview</h2>
            <div className="mt-4 space-y-3 text-sm text-[#5F6368]">
              <p>
                <span className="font-normal text-[#202124]">Auth admin user:</span>{' '}
                {session?.user?.email || 'n/a'}
              </p>
              <p>
                <span className="font-normal text-[#202124]">Tenant whitelist entries:</span>{' '}
                {loading ? '...' : totalTenants}
              </p>
              <p>
                <span className="font-normal text-[#202124]">Active tenants:</span>{' '}
                {loading ? '...' : activeTenants}
              </p>
            </div>
          </article>

          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">Quick Actions</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <a href="/admin/tenants" className={primaryBtnClass}>
                Manage tenant whitelist
              </a>
              <a href="/profile" className={secondaryBtnClass}>
                Open profile
              </a>
            </div>
          </article>
        </section>
      </div>
    </>
  );
}
