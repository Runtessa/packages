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
import { DEFAULT_ADAPTER_CONFIG_TEMPLATE } from '@/lib/tenant-adapter-config';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type TenantFormState = {
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

const DEFAULT_FORM: TenantFormState = {
  hostname: '',
  isSuspended: false,
  allowRegistration: true,
  memory: '512',
  timeout: '5000',
  authDbMode: 'shared',
  authDbSecretKey: '',
};

const DEFAULT_CONFIG_TEXT = DEFAULT_ADAPTER_CONFIG_TEMPLATE;

const parseConfigJson = (value: string) => {
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Adapter config must be valid JSON.');
  }
};

const validateTenantForm = (values: TenantFormState): TenantFormErrors => {
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

export default function AdminTenantCreatePage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<TenantFormState>(DEFAULT_FORM);
  const [adapterConfigText, setAdapterConfigText] = useState(DEFAULT_CONFIG_TEXT);
  const [validationErrors, setValidationErrors] = useState<TenantFormErrors>({
    hostname: '',
    memory: '',
    timeout: '',
    authDbSecretKey: '',
  });
  const [editorExpanded, setEditorExpanded] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      if (!ready || !token) return;
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
        }
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    bootstrap();
  }, [ready, token, router, setToken]);

  const buildPayload = (values: TenantFormState, configText?: string) => ({
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
    if (hasErrors(errors)) return;
    if (!token) return;

    try {
      const payload = buildPayload(form, adapterConfigText);
      const data = await fetchJson('/api/admin/tenants', {
        method: 'POST',
        token,
        body: payload,
      });
      success(`Created tenant ${data?.tenant?.hostname || payload.hostname}`);
      router.push('/admin/tenants');
    } catch (err: any) {
      showError(err.message || 'Failed to create tenant');
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
        <PageHeader title="Create tenant" subtitle="You do not have access to tenant management." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create tenant"
        subtitle="Provision a new tenant and configure adapters."
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

      <DataCard title="Tenant details" subtitle="Fill the required values and save.">
        <FormLayout
          onSubmit={handleSubmit}
          actions={
            <>
              <Button variant="secondary" href="/admin/tenants">
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create tenant
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
              Use secret references such as <code>adapter:redis:cache:default</code>. Manage secret values from the tenant secrets page.
            </p>
          </div>
        </FormLayout>
      </DataCard>
    </div>
  );
}
