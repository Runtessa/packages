import Head from 'next/head';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataCard } from '../../components/ui/DataCard';
import { Button } from '../../components/ui/Button';

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
            <div className="flex gap-2">
              <Button href="/profile" variant="secondary">
                Back to profile
              </Button>
              <Button href="/admin/tenants" variant="primary">
                Open tenant panel
              </Button>
            </div>
          }
        />

        {error ? <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div> : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <DataCard title="Auth admin user">
            <p className="truncate text-lg font-semibold">{session?.user?.email || 'n/a'}</p>
          </DataCard>
          <DataCard title="Tenant whitelist entries">
            <p className="text-lg font-semibold">{loading ? '...' : totalTenants}</p>
          </DataCard>
          <DataCard title="Active tenants">
            <p className="text-lg font-semibold">{loading ? '...' : activeTenants}</p>
          </DataCard>
        </div>

        <DataCard title="Quick actions">
          <div className="flex flex-wrap gap-2">
            <Button href="/admin/tenants" variant="primary">
              Manage tenant whitelist
            </Button>
            <Button href="/profile" variant="secondary">
              Open profile
            </Button>
          </div>
        </DataCard>
      </div>
    </>
  );
}
