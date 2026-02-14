import { FormEvent, useEffect, useMemo, useState } from 'react';
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

type SharedModuleProject = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  dependencies: string[];
  fileExtension: string;
  createdAt?: string;
  updatedAt?: string;
};

type SharedEndpoint = {
  id: string;
  routePath: string;
  method: string;
  packageId?: string;
  packageName?: string;
  packageVersion?: string;
  updatedAt?: string;
};

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

type EndpointFormState = {
  routePath: string;
  method: string;
};

type EndpointFormErrors = {
  routePath: string;
};

const FILE_EXTENSION_OPTIONS = [
  { label: 'JS', value: 'js' },
  { label: 'JSON', value: 'json' },
];

const METHOD_OPTIONS = [
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' },
  { label: 'DELETE', value: 'DELETE' },
];

const DEFAULT_FORM: ProjectFormState = {
  name: '',
  version: '1.0.0',
  entryPath: 'src/index.js',
  fileExtension: 'js',
  dependencies: '',
};

const formatDeps = (deps?: string[]) => (deps && deps.length ? deps.join('\n') : '');

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

const validateEndpoint = (values: EndpointFormState): EndpointFormErrors => {
  const errors: EndpointFormErrors = { routePath: '' };
  if (!values.routePath.trim()) errors.routePath = 'Route path is required';
  return errors;
};

export default function AdminSharedModuleEditPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProjectFormState>(DEFAULT_FORM);
  const [validationErrors, setValidationErrors] = useState<ProjectFormErrors>({
    name: '',
    version: '',
    entryPath: '',
  });
  const [endpoints, setEndpoints] = useState<SharedEndpoint[]>([]);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [endpointForm, setEndpointForm] = useState<EndpointFormState>({
    routePath: '/api/auth',
    method: 'GET',
  });
  const [endpointErrors, setEndpointErrors] = useState<EndpointFormErrors>({
    routePath: '',
  });
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [endpointEditForm, setEndpointEditForm] = useState<EndpointFormState>({
    routePath: '',
    method: 'GET',
  });
  const [endpointEditErrors, setEndpointEditErrors] = useState<EndpointFormErrors>({
    routePath: '',
  });

  const idRaw = router.query.id;
  const projectId = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  const projectEndpoints = useMemo(
    () => endpoints.filter((endpoint) => endpoint.packageId === projectId),
    [endpoints, projectId]
  );

  const loadEndpoints = async () => {
    if (!token) return;
    setEndpointLoading(true);
    try {
      const data = await fetchJson('/api/admin/shared-modules/endpoints', { token });
      setEndpoints(data.endpoints || []);
    } catch (err: any) {
      setError(err.message);
      if (err.message?.toLowerCase().includes('unauthorized')) {
        setToken('');
      }
    } finally {
      setEndpointLoading(false);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      if (!ready || !token || !projectId) return;
      try {
        const meRes = await fetch('/api/me', {
          headers: { Authorization: `Session ${token}` },
        });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        const role = meData?.user?.role;
        setIsAdmin(hasPermissionFromUser(meData.user, 'ide.shared_modules.write'));
        if (!hasPermissionFromUser(meData.user, 'ide.shared_modules.write')) {
          router.replace('/dashboard');
          return;
        }
        const payload = await fetchJson(`/api/admin/shared-modules/${projectId}`, { token });
        const project = (payload?.package ?? payload) as SharedModuleProject | undefined;
        if (!project) {
          setError('Shared backend project not found');
          return;
        }
        setForm({
          name: project.name,
          version: project.version,
          entryPath: project.entryPath || 'src/index.js',
          fileExtension: project.fileExtension || 'js',
          dependencies: formatDeps(project.dependencies),
        });
        await loadEndpoints();
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
  }, [token, ready, setToken, router, projectId]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const errors = validateForm(form);
    setValidationErrors(errors);
    if (hasErrors(errors) || !projectId) return;

    try {
      const deps = parseDeps(form.dependencies);
      await fetchJson(`/api/admin/shared-modules/${projectId}`, {
        method: 'PUT',
        token,
        body: {
          name: form.name,
          version: form.version,
          entryPath: form.entryPath,
          dependencies: deps,
          fileExtension: form.fileExtension || 'js',
        },
      });
      success('Shared backend project updated');
      router.push('/admin/shared-modules');
    } catch (err: any) {
      showError(err.message || 'Failed to update shared backend project');
    }
  };

  const handleEndpointCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !projectId) return;
    setEndpointErrors({ routePath: '' });
    const errors = validateEndpoint(endpointForm);
    setEndpointErrors(errors);
    if (errors.routePath) return;

    try {
      await fetchJson('/api/admin/shared-modules/endpoints', {
        method: 'POST',
        token,
        body: {
          routePath: endpointForm.routePath,
          method: endpointForm.method,
          packageId: projectId,
        },
      });
      success('Route added');
      setEndpointForm({ routePath: '/api/auth', method: 'GET' });
      await loadEndpoints();
    } catch (err: any) {
      showError(err.message || 'Failed to add route');
    }
  };

  const startEditEndpoint = (endpoint: SharedEndpoint) => {
    setEditingEndpointId(endpoint.id);
    setEndpointEditForm({ routePath: endpoint.routePath, method: endpoint.method });
    setEndpointEditErrors({ routePath: '' });
  };

  const cancelEditEndpoint = () => {
    setEditingEndpointId(null);
    setEndpointEditForm({ routePath: '', method: 'GET' });
    setEndpointEditErrors({ routePath: '' });
  };

  const handleEndpointEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !editingEndpointId) return;
    const errors = validateEndpoint(endpointEditForm);
    setEndpointEditErrors(errors);
    if (errors.routePath) return;

    try {
      await fetchJson(`/api/admin/shared-modules/endpoints/${editingEndpointId}`, {
        method: 'PUT',
        token,
        body: {
          routePath: endpointEditForm.routePath,
          method: endpointEditForm.method,
        },
      });
      success('Route updated');
      cancelEditEndpoint();
      await loadEndpoints();
    } catch (err: any) {
      showError(err.message || 'Failed to update route');
    }
  };

  const handleEndpointDelete = async (endpointId: string) => {
    if (!token) return;
    try {
      await fetchJson(`/api/admin/shared-modules/endpoints/${endpointId}`, {
        method: 'DELETE',
        token,
      });
      success('Route deleted');
      await loadEndpoints();
    } catch (err: any) {
      showError(err.message || 'Failed to delete route');
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
        <PageHeader title="Edit shared backend" subtitle="You do not have access to shared backend projects." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator.">
          <div className="text-sm text-textMuted">Access requires an admin account.</div>
        </DataCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit shared backend"
        subtitle={form.name ? `Update ${form.name}` : 'Update shared backend project.'}
        actions={
          <Button variant="secondary" size="sm" href="/admin/shared-modules">
            Back to shared backends
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard title="Project details" subtitle="Update backend package metadata.">
        {loading ? (
          <div className="text-sm text-textMuted">Loading project…</div>
        ) : (
          <FormLayout
            onSubmit={handleSubmit}
            gridClassName="grid gap-4 md:grid-cols-2"
            actions={
              <>
                <Button variant="secondary" href="/admin/shared-modules">
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save changes
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
              placeholder="src/index.js"
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
        )}
      </DataCard>

      <DataCard
        title="Shared backend routes"
        subtitle="Routes attached to this backend project."
      >
        <div className="space-y-6">
          <FormLayout
            onSubmit={handleEndpointCreate}
            actions={
              <Button type="submit" variant="primary" disabled={!projectId}>
                Add route
              </Button>
            }
            gridClassName="grid gap-4 md:grid-cols-3"
          >
            <Input
              label="Route path"
              value={endpointForm.routePath}
              onChange={(event) => setEndpointForm({ ...endpointForm, routePath: event.target.value })}
              error={endpointErrors.routePath}
              placeholder="/api/auth"
            />
            <Select
              label="Method"
              value={endpointForm.method}
              options={METHOD_OPTIONS}
              onChange={(event) => setEndpointForm({ ...endpointForm, method: event.target.value })}
            />
            <Input label="Project" value={form.name || '—'} disabled />
          </FormLayout>

          <div className="rounded-lg border border-borderSubtle bg-bgSurface">
            <div className="border-b border-borderSubtle px-4 py-2 text-xs uppercase tracking-wide text-textMuted">
              {endpointLoading ? 'Loading routes…' : `${projectEndpoints.length} routes`}
            </div>
            <div className="divide-y divide-borderSubtle">
              {projectEndpoints.length === 0 && !endpointLoading ? (
                <div className="px-4 py-6 text-sm text-textMuted">No routes defined.</div>
              ) : (
                projectEndpoints.map((endpoint) => (
                  <div key={endpoint.id} className="px-4 py-3 text-sm text-textPrimary">
                    {editingEndpointId === endpoint.id ? (
                      <form onSubmit={handleEndpointEdit} className="grid gap-3 md:grid-cols-4">
                        <Input
                          label="Route path"
                          value={endpointEditForm.routePath}
                          onChange={(event) =>
                            setEndpointEditForm({
                              ...endpointEditForm,
                              routePath: event.target.value,
                            })
                          }
                          error={endpointEditErrors.routePath}
                        />
                        <Select
                          label="Method"
                          value={endpointEditForm.method}
                          options={METHOD_OPTIONS}
                          onChange={(event) =>
                            setEndpointEditForm({
                              ...endpointEditForm,
                              method: event.target.value,
                            })
                          }
                        />
                        <Input label="Project" value={form.name || '—'} disabled />
                        <div className="flex items-end gap-2">
                          <Button type="submit" variant="primary" size="sm">
                            Save
                          </Button>
                          <Button type="button" variant="secondary" size="sm" onClick={cancelEditEndpoint}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="rounded bg-bgApp px-2 py-0.5 text-xs uppercase text-textMuted">
                            {endpoint.method}
                          </span>
                          <span className="font-mono text-xs text-textPrimary">{endpoint.routePath}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => startEditEndpoint(endpoint)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="xs"
                            onClick={() => handleEndpointDelete(endpoint.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DataCard>
    </div>
  );
}
