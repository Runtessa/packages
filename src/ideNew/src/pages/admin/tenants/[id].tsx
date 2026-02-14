import { FormEvent, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';
import { getSelectedTenantHost, setSelectedTenantHost } from '@/lib/client/tenant';
import { buildAdapterConfigTemplate } from '@/lib/tenant-adapter-config';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type TenantSummary = {
  id: string;
  hostname: string;
  isSuspended: boolean;
  allowRegistration?: boolean;
  resourceConfig?: { memory: number; timeout: number };
  adapterAccess?: Record<string, { allow: string[] }>;
  adapterConfig?: Record<string, unknown>;
  authDbConfig?: { mode?: 'shared' | 'dedicated'; secretKey?: string | null };
  createdAt?: string;
  updatedAt?: string;
};

type TenantDetails = {
  tenant: TenantSummary;
  secrets?: Array<{ keyName: string; updatedAt?: string }>;
};

type TenantEditState = {
  id: string;
  originalHostname: string;
  hostname: string;
  isSuspended: boolean;
  allowRegistration: boolean;
  memory: string;
  timeout: string;
  authDbMode: 'shared' | 'dedicated';
  authDbSecretKey: string;
};

type TenantFormErrors = {
  hostname: string;
  memory: string;
  timeout: string;
  authDbSecretKey: string;
};

const DEFAULT_FORM: TenantEditState = {
  id: '',
  originalHostname: '',
  hostname: '',
  isSuspended: false,
  allowRegistration: true,
  memory: '512',
  timeout: '5000',
  authDbMode: 'shared',
  authDbSecretKey: '',
};

const DEFAULT_CONFIG_TEXT = JSON.stringify(
  {
    adapters: {
      postgres: {
        pga1: {
          read: [
            {
              host: '',
              port: '',
              username: '',
              password: '',
              database: '',
            },
          ],
          write: {
            host: '',
            port: '',
            username: '',
            password: '',
            database: '',
          },
        },
      },
      mysql: {},
      mssql: {},
      redis: {},
      kafka: {},
      s3: {},
    },
  },
  null,
  2
);

const EMPTY_CONFIG_TEXT = JSON.stringify({ adapters: {} }, null, 2);

const parseConfigJson = (value: string) => {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Adapter config must be valid JSON.');
  }
};

const validateTenantForm = (values: TenantEditState): TenantFormErrors => {
  const errors: TenantFormErrors = { hostname: '', memory: '', timeout: '', authDbSecretKey: '' };

  if (!values.hostname.trim()) {
    errors.hostname = 'Hostname is required';
  }

  const memory = Number(values.memory);
  if (!Number.isFinite(memory) || memory <= 0) {
    errors.memory = 'Memory must be a positive number';
  }

  const timeout = Number(values.timeout);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    errors.timeout = 'Timeout must be a positive number';
  }

  if (values.authDbMode === 'dedicated' && !values.authDbSecretKey.trim()) {
    errors.authDbSecretKey = 'Secret key is required for dedicated auth DB';
  }

  return errors;
};

const hasErrors = (errors: TenantFormErrors) =>
  Boolean(errors.hostname || errors.memory || errors.timeout || errors.authDbSecretKey);

export default function AdminTenantEditPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<TenantEditState>(DEFAULT_FORM);
  const [adapterConfigText, setAdapterConfigText] = useState(DEFAULT_CONFIG_TEXT);
  const [tenantSecrets, setTenantSecrets] = useState<Array<{ keyName: string; updatedAt?: string }>>(
    []
  );
  const [validationErrors, setValidationErrors] = useState<TenantFormErrors>({
    hostname: '',
    memory: '',
    timeout: '',
    authDbSecretKey: '',
  });
  const [editorExpanded, setEditorExpanded] = useState(false);

  const tenantIdRaw = router.query.id;
  const tenantId = Array.isArray(tenantIdRaw) ? tenantIdRaw[0] : tenantIdRaw;

  useEffect(() => {
    const bootstrap = async () => {
      if (!ready || !token || !tenantId) return;
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Session ${token}` },
        });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        const role = meData?.user?.role;
        setIsAdmin(hasPermissionFromUser(meData.user, 'ide.tenants.manage'));
        if (!hasPermissionFromUser(meData.user, 'ide.tenants.manage')) {
          router.replace('/dashboard');
          return;
        }
        const detail = (await fetchJson(`/api/admin/tenants/${tenantId}`, { token })) as TenantDetails;
        const tenant = detail?.tenant;
        if (!tenant) {
          setError('Tenant not found');
          return;
        }
        setForm({
          id: tenant.id,
          originalHostname: tenant.hostname,
          hostname: tenant.hostname,
          isSuspended: tenant.isSuspended,
          allowRegistration: tenant.allowRegistration ?? true,
          memory: String(tenant.resourceConfig?.memory ?? Number(DEFAULT_FORM.memory)),
          timeout: String(tenant.resourceConfig?.timeout ?? Number(DEFAULT_FORM.timeout)),
          authDbMode:
            tenant.authDbConfig?.mode === 'dedicated'
              ? 'dedicated'
              : 'shared',
          authDbSecretKey: tenant.authDbConfig?.secretKey ?? '',
        });
        const access = tenant.adapterAccess ?? {};
        const storedConfig = tenant.adapterConfig ?? {};
        const secrets = detail?.secrets ?? [];
        setTenantSecrets(secrets);
        if (storedConfig && Object.keys(storedConfig).length > 0) {
          setAdapterConfigText(JSON.stringify(storedConfig, null, 2));
        } else {
          const template = buildAdapterConfigTemplate(
            access ?? {},
            secrets.map((secret) => secret.keyName)
          );
          setAdapterConfigText(template === EMPTY_CONFIG_TEXT ? DEFAULT_CONFIG_TEXT : template);
        }
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      } finally {
        setLoading(false);
      }
    };
    bootstrap();
  }, [ready, token, tenantId, router, setToken]);

  const buildPayload = (values: TenantEditState, configText?: string) => ({
    hostname: values.hostname.trim(),
    isSuspended: values.isSuspended,
    allowRegistration: values.allowRegistration,
    resourceConfig: {
      memory: Number(values.memory),
      timeout: Number(values.timeout),
    },
    authDbConfig: {
      mode: values.authDbMode,
      secretKey: values.authDbMode === 'dedicated' ? values.authDbSecretKey.trim() : null,
    },
    adapterConfig: configText ? parseConfigJson(configText) : undefined,
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = validateTenantForm(form);
    setValidationErrors(errors);
    if (hasErrors(errors) || !form.id) return;
    if (!token) return;

    try {
      const payload = buildPayload(form, adapterConfigText);
      const data = await fetchJson(`/api/admin/tenants/${form.id}`, {
        method: 'PUT',
        token,
        body: payload,
      });
      const nextHostname = data?.tenant?.hostname || payload.hostname;
      success(`Updated tenant ${nextHostname}`);
      const selectedTenant = getSelectedTenantHost();
      if (selectedTenant && form.originalHostname === selectedTenant) {
        if (nextHostname && nextHostname !== selectedTenant) {
          setSelectedTenantHost(nextHostname);
        }
      }
      router.push('/admin/tenants');
    } catch (err: any) {
      showError(err.message || 'Failed to update tenant');
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

  if (isAdmin === false) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit tenant" subtitle="You do not have access to tenant management." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit tenant"
        subtitle={form.hostname ? `Update ${form.hostname}` : 'Update tenant settings.'}
        actions={
          <Button variant="secondary" size="sm" href="/admin/tenants">
            Back to tenants
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Tenant configuration" subtitle="Update core settings and adapter JSON.">
        {loading ? (
          <div className="text-sm text-textMuted">Loading tenant data…</div>
        ) : (
          <FormLayout
            onSubmit={handleSubmit}
            actions={
              <>
                <Button variant="secondary" href="/admin/tenants">
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save changes
                </Button>
              </>
            }
            gridClassName="grid gap-4 md:grid-cols-2"
          >
            <div className="md:col-span-2">
              <Input
                label="Hostname"
                placeholder="tenant.example.com"
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                error={validationErrors.hostname}
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm text-textPrimary">
              <input
                type="checkbox"
                checked={form.isSuspended}
                onChange={(e) => setForm({ ...form, isSuspended: e.target.checked })}
                className="h-4 w-4 rounded border-borderSubtle text-accent focus:ring-accent/30"
              />
              Suspended
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm text-textPrimary">
              <input
                type="checkbox"
                checked={form.allowRegistration}
                onChange={(e) => setForm({ ...form, allowRegistration: e.target.checked })}
                className="h-4 w-4 rounded border-borderSubtle text-accent focus:ring-accent/30"
              />
              Allow registration
            </label>
            <Input
              label="Memory (MB)"
              type="number"
              min="1"
              step="64"
              value={form.memory}
              onChange={(e) => setForm({ ...form, memory: e.target.value })}
              error={validationErrors.memory}
            />
            <Input
              label="Timeout (ms)"
              type="number"
              min="1"
              step="100"
              value={form.timeout}
              onChange={(e) => setForm({ ...form, timeout: e.target.value })}
              error={validationErrors.timeout}
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-textPrimary">Auth DB mode</label>
              <select
                value={form.authDbMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    authDbMode: e.target.value === 'dedicated' ? 'dedicated' : 'shared',
                  })
                }
                className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary focus:border-accent focus:outline-none"
              >
                <option value="shared">Shared (use global USER_DB_*)</option>
                <option value="dedicated">Dedicated (use tenant secret key)</option>
              </select>
            </div>
            <Input
              label="Auth DB secret key"
              placeholder="userdb:tenant-a"
              value={form.authDbSecretKey}
              onChange={(e) => setForm({ ...form, authDbSecretKey: e.target.value })}
              error={validationErrors.authDbSecretKey}
              disabled={form.authDbMode !== 'dedicated'}
            />
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-textPrimary">Adapter config (JSON)</label>
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
                className={`overflow-hidden rounded-lg border border-borderSubtle bg-bgSurface ${
                  editorExpanded ? 'h-[70vh]' : 'h-48'
                }`}
              >
                <MonacoEditor
                  height="100%"
                  language="json"
                  theme="vs-dark"
                  value={adapterConfigText}
                  onChange={(value) => setAdapterConfigText(value ?? '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                  }}
                />
              </div>
              <p className="text-xs text-textMuted">
                Existing secrets:{' '}
                {tenantSecrets.length
                  ? tenantSecrets.map((s) => s.keyName).join(', ')
                  : 'none'}
                . Values you enter are encrypted on save.
              </p>
            </div>
          </FormLayout>
        )}
      </DataCard>
    </div>
  );
}
