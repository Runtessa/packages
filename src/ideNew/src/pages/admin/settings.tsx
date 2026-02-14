import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const res = await fetch('/api/me', { headers: { Authorization: `Session ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load user');
        setIsAdmin(hasPermissionFromUser(data.user, 'ide.settings.manage'));
        if (!hasPermissionFromUser(data.user, 'ide.settings.manage')) {
          router.replace('/dashboard');
        }
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
          router.replace('/login');
        }
      }
    };
    load();
  }, [token, ready, setToken, router]);

  if (ready && !token) {
    return (
      <div className="min-h-screen bg-bgApp px-4 py-10 text-left text-textPrimary">
        <div className="mx-auto w-full max-w-md space-y-3 rounded-xl border border-borderSubtle bg-bgSurface p-6 shadow-soft">
          <h2 className="text-xl font-semibold">Please log in</h2>
          <p className="text-sm text-textMuted">
            Your session expired or is missing. <a href="/login" className="text-accent">Go to login</a>.
          </p>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="space-y-6">
        <PageHeader title="System Settings" subtitle="Global application configuration." />
        <DataCard title="Permission Denied" subtitle="You do not have access to system settings.">
          <p className="text-sm text-textMuted">Please contact an administrator if you believe this is an error.</p>
        </DataCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="System Settings" subtitle="Global application configuration." />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="General Configuration" subtitle="Configure platform-wide behaviors.">
        <div className="flex items-center justify-between rounded-lg border border-borderSubtle bg-bgApp px-4 py-3 text-left">
          <div>
            <p className="text-sm font-semibold text-textPrimary">Maintenance Mode</p>
            <p className="text-xs text-textMuted">Toggle application-wide maintenance notifications.</p>
          </div>
          <input
            type="checkbox"
            disabled
            className="h-5 w-5 rounded border-borderSubtle bg-bgSurface text-primary"
          />
        </div>
      </DataCard>
    </div>
  );
}
