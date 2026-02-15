import Head from 'next/head';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';

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

const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-[#5F6368]';
const inputClass =
  'w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 text-sm text-[#202124] outline-none transition focus:border-[#1A73E8] focus:ring-2 focus:ring-[#D2E3FC]';
const checkboxClass = 'h-4 w-4 rounded border-[#C7C9CC] text-[#1A73E8] focus:ring-[#D2E3FC]';
const cardClass = 'rounded-[24px] p-6';
const primaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full bg-[#1A73E8] px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-[#1765cc] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#DADCE0] bg-white px-5 py-2.5 text-sm font-medium text-[#1A73E8] transition-all duration-200 hover:bg-[#F6F9FE] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';
const dangerBtnClass =
  'inline-flex items-center justify-center gap-2 rounded-full border border-[#F28B82] bg-white px-5 py-2.5 text-sm font-medium text-[#B3261E] transition-all duration-200 hover:bg-[#FDECEA] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-60';

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
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">Permission Denied</h2>
            <p className="mt-2 text-sm text-[#5F6368]">Use an auth admin account to access this panel.</p>
          </article>
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
            <div className="flex flex-wrap gap-2">
              <a href="/admin" className={secondaryBtnClass}>
                Back to dashboard
              </a>
            </div>
          }
        />

        {error ? <div className="rounded-xl border border-[#F28B82] bg-[#FDECEA] px-4 py-3 text-sm text-[#B3261E]">{error}</div> : null}
        {success ? <div className="rounded-xl border border-[#81C995] bg-[#E6F4EA] px-4 py-3 text-sm text-[#137333]">{success}</div> : null}
        {generatedToken ? (
          <div className="rounded-xl border border-[#81C995] bg-[#E6F4EA] px-4 py-3 text-sm text-[#137333]">
            <p className="font-semibold">Generated tenant SSO token</p>
            <code className="mt-2 block overflow-x-auto rounded-lg border border-[#DADCE0] bg-white px-2 py-1 text-xs text-[#202124]">
              {generatedToken}
            </code>
          </div>
        ) : null}

        <section className="grid w-full grid-cols-1 gap-6 xl:grid-cols-3">
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">Total entries</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{items.length}</p>
          </article>
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">Active entries</h2>
            <p className="mt-2 text-sm text-[#5F6368]">{activeCount}</p>
          </article>
          <article className={cardClass}>
            <h2 className="text-xl font-normal text-[#202124]">Session user</h2>
            <p className="mt-2 truncate text-sm text-[#5F6368]">{session?.user?.email || 'n/a'}</p>
          </article>
        </section>

        <article className={cardClass}>
          <h2 className="text-xl font-normal text-[#202124]">Create or update tenant entry</h2>
          <p className="mt-1 text-sm text-[#5F6368]">Whitelist controls for tenant host and SSO token validation.</p>
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="tenant_name">
                  Tenant name (host)
                </label>
                <input
                  id="tenant_name"
                  className={inputClass}
                  value={form.tenantName}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantName: e.target.value }))}
                  placeholder="tenant.example.com"
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="tenant_rand_id">
                  Tenant rand id (optional)
                </label>
                <input
                  id="tenant_rand_id"
                  className={inputClass}
                  value={form.tenantRandId}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantRandId: e.target.value }))}
                  placeholder="tenant-rand-id"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="tenant_display_name">
                  Tenant display name (optional)
                </label>
                <input
                  id="tenant_display_name"
                  className={inputClass}
                  value={form.tenantDisplayName}
                  onChange={(e) => setForm((prev) => ({ ...prev, tenantDisplayName: e.target.value }))}
                  placeholder="Tenant Display Name"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="custom_sso_token">
                  Custom SSO token (optional)
                </label>
                <input
                  id="custom_sso_token"
                  className={inputClass}
                  value={form.customToken}
                  onChange={(e) => setForm((prev) => ({ ...prev, customToken: e.target.value }))}
                  placeholder="empty = auto-generate"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="inline-flex items-center gap-2 text-sm text-[#5F6368]">
                <input
                  className={checkboxClass}
                  type="checkbox"
                  checked={form.allowRegistration}
                  onChange={(e) => setForm((prev) => ({ ...prev, allowRegistration: e.target.checked }))}
                />
                Allow registration for this tenant
              </label>

              <label className="inline-flex items-center gap-2 text-sm text-[#5F6368]">
                <input
                  className={checkboxClass}
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
                />
                Entry is active
              </label>
            </div>

            <button type="submit" className={primaryBtnClass} disabled={loading || !csrfToken || !canManage}>
              Save tenant entry
            </button>
          </form>
        </article>

        <article className={cardClass}>
          <h2 className="text-xl font-normal text-[#202124]">Current whitelist</h2>
          <p className="mt-1 text-sm text-[#5F6368]">Showing {items.length} tenant entries</p>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[#E8EAED] bg-white">
            <table className="w-full border-collapse text-left text-sm text-[#202124]">
              <thead className="bg-[#F8F9FA] text-[#5F6368]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tenant</th>
                  <th className="px-4 py-3 font-semibold">Tenant ID</th>
                  <th className="px-4 py-3 font-semibold">Allow Reg</th>
                  <th className="px-4 py-3 font-semibold">Active</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EAED]">
                {loading ? (
                  <tr>
                    <td className="px-4 py-3 text-[#5F6368]" colSpan={6}>
                      Loading...
                    </td>
                  </tr>
                ) : items.length > 0 ? (
                  items.map((item) => (
                    <tr key={item.tenantName} className="text-sm transition hover:bg-[#F8F9FA]">
                      <td className="px-4 py-3 text-[#202124]">{item.tenantName}</td>
                      <td className="px-4 py-3 text-[#5F6368]">{item.tenantRandId || 'n/a'}</td>
                      <td className="px-4 py-3 text-[#5F6368]">
                        {boolFromMeta(item.meta, 'allowRegistration', false) ? 'yes' : 'no'}
                      </td>
                      <td className="px-4 py-3 text-[#5F6368]">{item.isActive ? 'yes' : 'no'}</td>
                      <td className="px-4 py-3 text-[#5F6368]">{new Date(item.updatedAt).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={secondaryBtnClass}
                            onClick={() => rotateToken(item.tenantName)}
                          >
                            Rotate token
                          </button>
                          <button
                            type="button"
                            className={dangerBtnClass}
                            onClick={() => removeTenant(item.tenantName)}
                          >
                            Delete
                          </button>
                          {strFromMeta(item.meta, 'tenantDisplayName') ? (
                            <span className="self-center text-xs text-[#5F6368]">
                              {strFromMeta(item.meta, 'tenantDisplayName')}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-3 text-[#5F6368]" colSpan={6}>
                      No tenant whitelist entries found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    </>
  );
}
