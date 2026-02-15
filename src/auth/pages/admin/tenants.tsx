import Head from 'next/head';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { DataCard } from '../../components/ui/DataCard';
import { DataTable } from '../../components/ui/DataTable';
import { Button } from '../../components/ui/Button';

interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
    isAuthAdmin?: boolean;
  };
}

interface TenantItem {
  tenantName: string;
  tenantRandId: string | null;
  isActive: boolean;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const boolFromMeta = (meta: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean => {
  const value = meta?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

const strFromMeta = (meta: Record<string, unknown> | undefined, key: string): string => {
  const value = meta?.[key];
  return typeof value === 'string' ? value : '';
};

export default function AdminTenantsPage() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [items, setItems] = useState<TenantItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');

  const [form, setForm] = useState({
    tenantName: '',
    tenantRandId: '',
    tenantDisplayName: '',
    allowRegistration: true,
    isActive: true,
    customToken: '',
  });

  const csrfToken = session?.csrfToken || '';
  const canManage = Boolean(session?.authenticated && session.user?.isAuthAdmin);

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const sessionRes = await fetch('/api/session', { credentials: 'include' });
      const sessionData = (await sessionRes.json()) as SessionPayload;
      setSession(sessionData);

      if (!sessionData.authenticated) {
        setError('Authentication required');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/admin/tenant-whitelist', { credentials: 'include' });
      const data = (await res.json()) as { items?: TenantItem[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load tenant whitelist');
      }

      setItems(data.items || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unexpected error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setGeneratedToken('');

    try {
      const payload = {
        tenant_name: form.tenantName,
        tenant_rand_id: form.tenantRandId || null,
        tenant_display_name: form.tenantDisplayName || null,
        allow_registration: form.allowRegistration,
        is_active: form.isActive,
        sso_token: form.customToken || undefined,
      };

      const res = await fetch('/api/admin/tenant-whitelist', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as { generatedToken?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save tenant');
      }

      setSuccess('Tenant whitelist entry saved.');
      if (data.generatedToken) {
        setGeneratedToken(data.generatedToken);
      }
      setForm((prev) => ({ ...prev, customToken: '' }));
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unexpected error');
    }
  };

  const rotateToken = async (tenantName: string) => {
    setError('');
    setSuccess('');
    setGeneratedToken('');

    try {
      const res = await fetch(`/api/admin/tenant-whitelist/${encodeURIComponent(tenantName)}/rotate-token`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      });

      const data = (await res.json()) as { generatedToken?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to rotate token');
      }

      if (data.generatedToken) {
        setGeneratedToken(data.generatedToken);
      }
      setSuccess(`Token rotated for ${tenantName}.`);
      await load();
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : 'Unexpected error');
    }
  };

  const removeTenant = async (tenantName: string) => {
    setError('');
    setSuccess('');
    setGeneratedToken('');

    try {
      const res = await fetch(`/api/admin/tenant-whitelist/${encodeURIComponent(tenantName)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
      });

      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete tenant');
      }

      setSuccess(`Deleted ${tenantName}.`);
      await load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unexpected error');
    }
  };

  const activeCount = useMemo(() => items.filter((item) => item.isActive).length, [items]);

  if (session?.authenticated && session.user && !session.user.isAuthAdmin) {
    return (
      <>
        <Head>
          <title>Auth Admin | Tenant SSO Whitelist</title>
        </Head>
        <div className="space-y-6">
          <PageHeader title="Tenants" subtitle="Tenant SSO whitelist management." />
          <DataCard title="Permission Denied" subtitle="You do not have auth admin access.">
            <p className="text-sm text-textMuted">Use an auth admin account to access this panel.</p>
          </DataCard>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Auth Admin | Tenant SSO Whitelist</title>
      </Head>

      <div className="space-y-6">
        <PageHeader
          title="Tenants"
          subtitle="Standard callback pattern: https://tenant-host/auth"
          actions={
            <div className="flex gap-2">
              <Button href="/admin" variant="secondary">
                Back to dashboard
              </Button>
            </div>
          }
        />

        {error ? <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div> : null}
        {success ? <div className="rounded-lg border border-success bg-bgApp px-4 py-3 text-sm text-success">{success}</div> : null}
        {generatedToken ? (
          <div className="rounded-lg border border-success bg-bgApp px-4 py-3 text-sm text-success">
            <p className="font-semibold">Generated tenant SSO token</p>
            <code className="mt-2 block overflow-x-auto rounded-md bg-bgSurface px-2 py-1 text-xs text-accent">
              {generatedToken}
            </code>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <DataCard title="Total entries">
            <p className="text-lg font-semibold">{items.length}</p>
          </DataCard>
          <DataCard title="Active entries">
            <p className="text-lg font-semibold">{activeCount}</p>
          </DataCard>
          <DataCard title="Session user">
            <p className="truncate text-lg font-semibold">{session?.user?.email || 'n/a'}</p>
          </DataCard>
        </div>

        <DataCard
          title="Create or update tenant entry"
          subtitle="Whitelist controls for tenant host and SSO token validation."
        >
          <form className="space-y-4" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="tenant_name">
                  Tenant name (host)
                </label>
                <input
                  id="tenant_name"
                  className="input"
                  value={form.tenantName}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantName: e.target.value }))}
                  placeholder="tenant.example.com"
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="tenant_rand_id">
                  Tenant rand id (optional)
                </label>
                <input
                  id="tenant_rand_id"
                  className="input"
                  value={form.tenantRandId}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantRandId: e.target.value }))}
                  placeholder="tenant-rand-id"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="tenant_display_name">
                  Tenant display name (optional)
                </label>
                <input
                  id="tenant_display_name"
                  className="input"
                  value={form.tenantDisplayName}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantDisplayName: e.target.value }))}
                  placeholder="Tenant Display Name"
                />
              </div>
              <div>
                <label className="label" htmlFor="custom_sso_token">
                  Custom SSO token (optional)
                </label>
                <input
                  id="custom_sso_token"
                  className="input"
                  value={form.customToken}
                  onChange={(e) => setForm((prev) => ({ ...prev, customToken: e.target.value }))}
                  placeholder="empty = auto-generate"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="inline-flex items-center gap-2 text-sm text-textMuted">
                <input
                  className="h-4 w-4 rounded border-borderSubtle bg-bgApp"
                  type="checkbox"
                  checked={form.allowRegistration}
                  onChange={(e) => setForm((prev) => ({ ...prev, allowRegistration: e.target.checked }))}
                />
                Allow registration for this tenant
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-textMuted">
                <input
                  className="h-4 w-4 rounded border-borderSubtle bg-bgApp"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                />
                Entry is active
              </label>
            </div>

            <Button type="submit" variant="primary" disabled={loading || !csrfToken || !canManage}>
              Save tenant entry
            </Button>
          </form>
        </DataCard>

        <DataCard title="Current whitelist" subtitle={`Showing ${items.length} tenant entries`}>
          <DataTable
            headers={['Tenant', 'Tenant ID', 'Allow Reg', 'Active', 'Updated', 'Actions']}
            loading={loading}
            emptyMessage="No tenant whitelist entries found."
          >
            {items.map((item) => (
              <tr key={item.tenantName} className="text-sm hover:bg-bgApp transition">
                <td className="px-4 py-3 text-textPrimary">{item.tenantName}</td>
                <td className="px-4 py-3 text-textMuted">{item.tenantRandId || 'n/a'}</td>
                <td className="px-4 py-3 text-textMuted">{boolFromMeta(item.meta, 'allowRegistration', false) ? 'yes' : 'no'}</td>
                <td className="px-4 py-3 text-textMuted">{item.isActive ? 'yes' : 'no'}</td>
                <td className="px-4 py-3 text-textMuted">{new Date(item.updatedAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => rotateToken(item.tenantName)}>
                      Rotate token
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => removeTenant(item.tenantName)}>
                      Delete
                    </Button>
                    {strFromMeta(item.meta, 'tenantDisplayName') ? (
                      <span className="text-xs text-textMuted">{strFromMeta(item.meta, 'tenantDisplayName')}</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </DataCard>
      </div>
    </>
  );
}
