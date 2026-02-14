import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';
import { IDE_ROLE_BLUEPRINT, IDE_ROLE_DESCRIPTIONS, IDE_ROLE_LABELS } from '@/lib/rbac';
import { AccessTabs } from '@/components/admin/AccessTabs';

type User = { email: string; role: string };
type UserListItem = { email: string; role: string; token: string; createdAt?: string };

export default function AdminUsersPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);

  useEffect(() => {
    if (!ready || !token) return;
  }, [token, router, ready]);

  useEffect(() => {
    const load = async () => {
      if (!ready || !token) return;
      try {
        const meRes = await fetch('/api/me', { headers: { Authorization: `Session ${token}` } });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        setUser(meData.user);
        if (!hasPermissionFromUser(meData.user, 'ide.users.manage')) {
          router.replace('/dashboard');
          return;
        }

        const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
        const list = await fetchJson(`/api/users?${qs.toString()}`, { token });
        setUsers(list.users || []);
        setTotal(list.total || 0);
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    load();
  }, [token, router, ready, setToken, page, limit]);

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

  return (
    <div className="space-y-6">
      <AccessTabs />
      <PageHeader
        title="Admin: Users"
        subtitle="Create users and API tokens."
        actions={
          <Button href="/admin/users/new" variant="primary" size="md">
            New user
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Existing users" subtitle={`Total ${total} users`}>
        <div className="space-y-4">
          <DataTable headers={['Email', 'Role', 'API Token', 'Created', 'Actions']} emptyMessage="No users yet.">
            {users.map((u) => (
              <tr key={u.email} className="text-sm hover:bg-bgApp transition">
                <td className="px-4 py-3 text-textPrimary">{u.email}</td>
                <td className="px-4 py-3 text-textMuted">
                  {IDE_ROLE_LABELS[u.role as keyof typeof IDE_ROLE_LABELS] || u.role}
                </td>
                <td className="px-4 py-3 font-mono break-words text-textPrimary">{u.token}</td>
                <td className="px-4 py-3 text-textMuted">
                  {u.createdAt ? new Date(u.createdAt).toLocaleString() : 'N/A'}
                </td>
                <td className="px-4 py-3 text-textMuted">
                  <Button
                    variant="secondary"
                    size="sm"
                    href={`/admin/users/${encodeURIComponent(u.email)}`}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="flex items-center justify-between px-2">
            <div className="text-sm text-textMuted">
              Page {page} of {Math.ceil(total / limit) || 1}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= Math.ceil(total / limit)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </DataCard>

      <DataCard title="Role Blueprint" subtitle="Global IDE roles applied to users and team memberships.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {IDE_ROLE_BLUEPRINT.filter((role) => role !== 'admin').map((role) => (
            <div key={role} className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-sm font-semibold text-textPrimary">
                {IDE_ROLE_LABELS[role] || role}
              </div>
              <div className="mt-1 text-xs text-textMuted">
                {IDE_ROLE_DESCRIPTIONS[role] || 'No description'}
              </div>
            </div>
          ))}
        </div>
      </DataCard>
    </div>
  );
}
