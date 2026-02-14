import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';

type User = { email: string; role: string };

type QuickLink = {
  label: string;
  href: string;
  description: string;
};

export default function DashboardPage() {
  const { token, setToken, ready } = useSessionToken();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/me', { headers: { Authorization: `Session ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load account data');
        setUser(data.user);
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token, ready, setToken]);

  const quickLinks: QuickLink[] = useMemo(() => {
    const links: QuickLink[] = [
      {
        label: 'Profile & credentials',
        href: '/profile',
        description: 'Update your email and password.',
      },
      {
        label: 'API documentation',
        href: '/docs',
        description: 'Review available endpoints.',
      },
    ];
    if (hasPermissionFromUser(user, 'ide.users.read')) {
      links.push({
        label: 'Team management',
        href: '/admin/teams',
        description: 'Create teams and manage member roles.',
      });
      links.push({
        label: 'User management',
        href: '/admin/users',
        description: 'Invite teammates and adjust roles.',
      });
      links.push({
        label: 'Shared projects',
        href: '/admin/shared-packages',
        description: 'Manage shared UI projects for all tenants.',
      });
    }
    return links;
  }, [user]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Secure control panel for account access and audit visibility."
        actions={
          <Button href="/docs" variant="primary" size="md">
            View docs
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Status" value={loading ? 'Loading...' : 'Signed in'} />
        <StatCard
          label="Role"
          value={user?.role ? user.role.toUpperCase() : 'Unknown'}
          tone={hasPermissionFromUser(user, 'ide.settings.manage') ? 'positive' : 'default'}
        />
        <StatCard label="User" value={user?.email || 'Not loaded'} />
      </div>

      <DataCard title="Account snapshot" subtitle="Your current access at a glance.">
        <div className="grid gap-3 text-sm text-textMuted md:grid-cols-2">
          <div className="rounded-xl border border-borderSubtle bg-bgApp p-4">
            <div className="text-xs uppercase tracking-[0.14em] text-textMuted">Email</div>
            <div className="text-lg font-semibold text-textPrimary">
              {user?.email || (loading ? 'Loading…' : 'Unknown')}
            </div>
          </div>
          <div className="rounded-xl border border-borderSubtle bg-bgApp p-4">
            <div className="text-xs uppercase tracking-[0.14em] text-textMuted">Role</div>
            <div className="text-lg font-semibold text-textPrimary">
              {user?.role || (loading ? 'Loading…' : 'Unknown')}
            </div>
          </div>
        </div>
      </DataCard>

      <DataCard title="Next steps" subtitle="Jump into the areas you need most.">
        <div className="grid gap-3 sm:grid-cols-2">
          {quickLinks.map((link) => (
            <div key={link.href} className="rounded-xl border border-borderSubtle bg-bgApp p-4">
              <div className="text-sm font-semibold text-textPrimary">{link.label}</div>
              <p className="mt-1 text-xs text-textMuted">{link.description}</p>
              <Button href={link.href} variant="secondary" size="sm" className="mt-3">
                Open
              </Button>
            </div>
          ))}
        </div>
      </DataCard>
    </div>
  );
}
