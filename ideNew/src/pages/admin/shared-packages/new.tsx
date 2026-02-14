import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';

type ProjectFormState = {
  name: string;
  version: string;
  entryPath: string;
  fileExtension: string;
  dependencies: string;
};

type ProjectFormErrors = {
  name: string;
  version: string;
  entryPath: string;
};

const FILE_EXTENSION_OPTIONS = [
  { label: 'JSX', value: 'jsx' },
  { label: 'JS', value: 'js' },
  { label: 'JSON', value: 'json' },
  { label: 'CSS', value: 'css' },
];

const DEFAULT_FORM: ProjectFormState = {
  name: '',
  version: '1.0.0',
  entryPath: 'src/index.jsx',
  fileExtension: 'jsx',
  dependencies: '',
};

const parseDeps = (value: string) =>
  value
    .split(/[\n,]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

const validateForm = (values: ProjectFormState): ProjectFormErrors => {
  const errors: ProjectFormErrors = { name: '', version: '', entryPath: '' };
  if (!values.name.trim()) errors.name = 'Name is required';
  if (!values.version.trim()) errors.version = 'Version is required';
  if (!values.entryPath.trim()) errors.entryPath = 'Entry file is required';
  return errors;
};

const hasErrors = (errors: ProjectFormErrors) =>
  Boolean(errors.name || errors.version || errors.entryPath);

export default function AdminSharedPackageCreatePage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<ProjectFormState>(DEFAULT_FORM);
  const [validationErrors, setValidationErrors] = useState<ProjectFormErrors>({
    name: '',
    version: '',
    entryPath: '',
  });

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
        setIsAdmin(hasPermissionFromUser(meData.user, 'ide.shared_ui.write'));
        if (!hasPermissionFromUser(meData.user, 'ide.shared_ui.write')) {
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
  }, [token, ready, setToken, router]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const errors = validateForm(form);
    setValidationErrors(errors);
    if (hasErrors(errors)) return;

    try {
      const deps = parseDeps(form.dependencies);
      await fetchJson('/api/admin/shared-packages', {
        method: 'POST',
        token,
        body: {
          name: form.name,
          version: form.version,
          entryPath: form.entryPath,
          dependencies: deps,
          fileExtension: form.fileExtension || 'jsx',
        },
      });
      success('Shared project created');
      router.push('/admin/shared-packages');
    } catch (err: any) {
      showError(err.message || 'Failed to create shared project');
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
        <PageHeader title="Create shared project" subtitle="You do not have access to shared projects." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create shared project"
        subtitle="Add a shared UI package for reuse across tenants."
        actions={
          <Button variant="secondary" size="sm" href="/admin/shared-packages">
            Back to shared projects
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Project details" subtitle="Fill in the package metadata.">
        <FormLayout
          onSubmit={handleSubmit}
          gridClassName="grid gap-4 md:grid-cols-2"
          actions={
            <>
              <Button variant="secondary" href="/admin/shared-packages">
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create project
              </Button>
            </>
          }
        >
          <Input
            label="Name"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            error={validationErrors.name}
          />
          <Input
            label="Version"
            value={form.version}
            onChange={(event) => setForm({ ...form, version: event.target.value })}
            error={validationErrors.version}
          />
          <Input
            label="Entry file"
            value={form.entryPath}
            onChange={(event) => setForm({ ...form, entryPath: event.target.value })}
            error={validationErrors.entryPath}
            placeholder="src/index.jsx"
          />
          <Select
            label="File extension"
            value={form.fileExtension}
            options={FILE_EXTENSION_OPTIONS}
            onChange={(event) => setForm({ ...form, fileExtension: event.target.value })}
          />
          <div className="md:col-span-2">
            <TextArea
              label="Dependencies"
              placeholder="one per line or comma-separated"
              rows={5}
              value={form.dependencies}
              onChange={(event) => setForm({ ...form, dependencies: event.target.value })}
            />
          </div>
        </FormLayout>
      </DataCard>
    </div>
  );
}
