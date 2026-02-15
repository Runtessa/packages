import Head from 'next/head';
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';

interface SessionPayload {
  authenticated: boolean;
  csrfToken?: string;
  user?: {
    randId: string;
    email: string;
    firstName: string;
    lastName: string;
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

  return (
    <>
      <Head>
        <title>Auth Admin | Tenant SSO Whitelist</title>
      </Head>

      <main className="min-h-screen bg-bgApp px-4 py-10 text-textPrimary">
        <div className="mx-auto w-full max-w-6xl space-y-5">
          <div className="card flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-textMuted">Auth Admin</p>
              <h1 className="mt-2 text-2xl font-semibold">Tenant SSO Whitelist</h1>
              <p className="mt-1 text-sm text-textMuted">
                Standard callback pattern: <code className="text-accent">https://tenant-host/auth</code>
              </p>
            </div>
            <Link className="btn-primary bg-primaryDark hover:bg-primary" href="/profile">
              Back to account
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="card px-4 py-3 text-sm">
              <p className="text-textMuted">Total entries</p>
              <p className="mt-1 text-lg font-semibold">{items.length}</p>
            </div>
            <div className="card px-4 py-3 text-sm">
              <p className="text-textMuted">Active entries</p>
              <p className="mt-1 text-lg font-semibold">{activeCount}</p>
            </div>
            <div className="card px-4 py-3 text-sm">
              <p className="text-textMuted">Session user</p>
              <p className="mt-1 truncate text-lg font-semibold">{session?.user?.email || 'n/a'}</p>
            </div>
          </div>

          {error ? <div className="alert-danger">{error}</div> : null}
          {success ? <div className="alert-success">{success}</div> : null}
          {generatedToken ? (
            <div className="alert-success">
              <p className="font-semibold">Generated tenant SSO token</p>
              <code className="mt-2 block overflow-x-auto rounded-md bg-bgApp px-2 py-1 text-xs text-accent">
                {generatedToken}
              </code>
            </div>
          ) : null}

          <form className="card space-y-4 px-6 py-5" onSubmit={submit}>
            <h2 className="text-lg font-semibold">Create or update tenant entry</h2>

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

            <button className="btn-primary" type="submit" disabled={loading || !csrfToken}>
              Save tenant entry
            </button>
          </form>

          <div className="card overflow-x-auto px-6 py-5">
            <h2 className="mb-4 text-lg font-semibold">Current whitelist</h2>
            {loading ? <p className="text-sm text-textMuted">Loading...</p> : null}

            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-borderSubtle text-textMuted">
                  <th className="py-2 pr-3">Tenant</th>
                  <th className="py-2 pr-3">Tenant ID</th>
                  <th className="py-2 pr-3">Allow Reg</th>
                  <th className="py-2 pr-3">Active</th>
                  <th className="py-2 pr-3">Updated</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.tenantName} className="border-b border-borderSubtle/60">
                    <td className="py-3 pr-3">{item.tenantName}</td>
                    <td className="py-3 pr-3 text-textMuted">{item.tenantRandId || 'n/a'}</td>
                    <td className="py-3 pr-3">{boolFromMeta(item.meta, 'allowRegistration', false) ? 'yes' : 'no'}</td>
                    <td className="py-3 pr-3">{item.isActive ? 'yes' : 'no'}</td>
                    <td className="py-3 pr-3 text-textMuted">{new Date(item.updatedAt).toLocaleString()}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button className="btn-primary px-3 py-2 text-xs" type="button" onClick={() => rotateToken(item.tenantName)}>
                          Rotate token
                        </button>
                        <button className="btn-danger" type="button" onClick={() => removeTenant(item.tenantName)}>
                          Delete
                        </button>
                        {strFromMeta(item.meta, 'tenantDisplayName') ? (
                          <span className="text-xs text-textMuted">{strFromMeta(item.meta, 'tenantDisplayName')}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
