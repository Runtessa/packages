import { FormEvent, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type TenantSummary = {
  id: string;
  hostname: string;
  canWrite?: boolean;
};

type SecretSummary = {
  keyName: string;
  createdAt?: string;
  updatedAt?: string;
};

type TenantDetailsResponse = {
  tenant?: TenantSummary;
};

type SecretsResponse = {
  secrets?: SecretSummary[];
};

export default function TenantSecretsPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const tenantIdRaw = router.query.id;
  const tenantId = Array.isArray(tenantIdRaw) ? tenantIdRaw[0] : tenantIdRaw;

  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [secrets, setSecrets] = useState<SecretSummary[]>([]);
  const [form, setForm] = useState({ keyName: '', value: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editorExpanded, setEditorExpanded] = useState(false);

  const canWrite = Boolean(tenant?.canWrite && canManage);

  const loadData = async (activeToken: string, activeTenantId: string) => {
    const [tenantData, secretsData] = await Promise.all([
      fetchJson(`/api/admin/tenants/${activeTenantId}`, { token: activeToken }) as Promise<TenantDetailsResponse>,
      fetchJson(`/api/admin/tenants/${activeTenantId}/secrets`, { token: activeToken }) as Promise<SecretsResponse>,
    ]);
    if (!tenantData?.tenant) {
      throw new Error('Tenant not found');
    }
    setTenant(tenantData.tenant);
    setSecrets(secretsData?.secrets || []);
  };

  useEffect(() => {
    const bootstrap = async () => {
      if (!ready || !token || !tenantId) return;
      setLoading(true);
      setError('');
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Session ${token}` },
        });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');

        const hasManagePermission = hasPermissionFromUser(meData.user, 'ide.tenants.manage');
        setCanManage(hasManagePermission);
        if (!hasPermissionFromUser(meData.user, 'ide.tenants.read')) {
          router.replace('/dashboard');
          return;
        }

        await loadData(token, tenantId);
      } catch (err: any) {
        setError(err.message || 'Failed to load secrets');
        if (String(err.message || '').toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      } finally {
        setLoading(false);
      }
    };

    bootstrap();
  }, [ready, token, tenantId, router, setToken]);

  const sortedSecrets = useMemo(
    () => [...secrets].sort((a, b) => a.keyName.localeCompare(b.keyName)),
    [secrets],
  );

  const onSaveSecret = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !tenantId || !canWrite) return;

    if (!form.keyName.trim()) {
      showError('Secret key is required');
      return;
    }
    if (!form.value.length) {
      showError('Secret value is required');
      return;
    }

    setSaving(true);
    try {
      await fetchJson(`/api/admin/tenants/${tenantId}/secrets`, {
        method: 'POST',
        token,
        body: {
          keyName: form.keyName.trim(),
          value: form.value,
        },
      });
      success(`Saved secret ${form.keyName.trim()}`);
      setForm((prev) => ({ ...prev, value: '' }));
      await loadData(token, tenantId);
    } catch (err: any) {
      showError(err.message || 'Failed to save secret');
    } finally {
      setSaving(false);
    }
  };

  const onDeleteSecret = async (keyName: string) => {
    if (!token || !tenantId || !canWrite) return;
    const confirmed = window.confirm(`Delete secret ${keyName}?`);
    if (!confirmed) return;

    try {
      await fetchJson(`/api/admin/tenants/${tenantId}/secrets/${encodeURIComponent(keyName)}`, {
        method: 'DELETE',
        token,
      });
      success(`Deleted secret ${keyName}`);
      await loadData(token, tenantId);
    } catch (err: any) {
      showError(err.message || 'Failed to delete secret');
    }
  };

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
      <PageHeader
        title="Tenant secrets"
        subtitle={tenant?.hostname ? `Manage secrets for ${tenant.hostname}` : 'Manage tenant secret values.'}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" href="/admin/tenants">
              Back to tenants
            </Button>
            {tenant?.id ? (
              <Button variant="secondary" size="sm" href={`/admin/tenants/${tenant.id}`}>
                Back to tenant
              </Button>
            ) : null}
          </div>
        }
      />

      {error ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      <DataCard
        title="Secret keys"
        subtitle="Store actual secret values here. Use references in adapterConfig, e.g. adapter:redis:cache:default."
      >
        <DataTable headers={['Key name', 'Updated', 'Actions']} loading={loading} emptyMessage="No secrets yet.">
          {sortedSecrets.map((secret) => (
            <tr key={secret.keyName} className="text-sm hover:bg-bgApp transition">
              <td className="px-4 py-3 font-mono text-xs text-textPrimary">{secret.keyName}</td>
              <td className="px-4 py-3 text-textMuted">
                {secret.updatedAt ? new Date(secret.updatedAt).toLocaleString() : 'N/A'}
              </td>
              <td className="px-4 py-3">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDeleteSecret(secret.keyName)}
                  disabled={!canWrite}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </DataTable>
      </DataCard>

      <DataCard title="Add or update secret" subtitle="Values are encrypted at rest and never returned to the browser.">
        <FormLayout
          onSubmit={onSaveSecret}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setForm({ keyName: '', value: '' })}
                disabled={saving}
              >
                Clear
              </Button>
              <Button type="submit" variant="primary" disabled={saving || !canWrite}>
                {saving ? 'Saving...' : 'Save secret'}
              </Button>
            </>
          }
          gridClassName="grid gap-4"
        >
          <Input
            label="Key name"
            placeholder="adapter:redis:cache:default"
            value={form.keyName}
            onChange={(event) => setForm((prev) => ({ ...prev, keyName: event.target.value }))}
            disabled={!canWrite}
          />
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-textPrimary">Secret value</label>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => setEditorExpanded((prev) => !prev)}
              >
                {editorExpanded ? 'Collapse' : 'Expand'}
              </Button>
            </div>
            <div
              className={`overflow-hidden rounded-md border border-borderSubtle bg-bgSurface ${
                editorExpanded ? 'h-[60vh]' : 'h-40'
              }`}
            >
              <MonacoEditor
                height="100%"
                language="json"
                theme="vs-dark"
                value={form.value}
                onChange={(value) => setForm((prev) => ({ ...prev, value: value ?? '' }))}
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  readOnly: !canWrite,
                }}
              />
            </div>
          </div>
        </FormLayout>
      </DataCard>
    </div>
  );
}
