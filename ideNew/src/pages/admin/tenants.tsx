import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { FormLayout } from '@/components/ui/FormLayout';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { getSelectedTenantHost, setSelectedTenantHost } from '@/lib/client/tenant';

type TenantSummary = {
  id: string;
  hostname: string;
  isSuspended: boolean;
  resourceConfig?: { memory: number; timeout: number };
  restrictRoutes?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type TenantFormState = {
  hostname: string;
  isSuspended: boolean;
  memory: string;
  timeout: string;
  restrictRoutes: string;
};

type TenantEditState = TenantFormState & {
  id: string;
  originalHostname: string;
};

type TenantFormErrors = {
  hostname: string;
  memory: string;
  timeout: string;
};

const DEFAULT_FORM: TenantFormState = {
  hostname: '',
  isSuspended: false,
  memory: '512',
  timeout: '5000',
  restrictRoutes: '',
};

const DEFAULT_EDIT_FORM: TenantEditState = {
  id: '',
  originalHostname: '',
  ...DEFAULT_FORM,
};

const formatRoutes = (routes?: string[]) => (routes && routes.length ? routes.join('\n') : '');

const parseRoutes = (value: string) => {
  if (!value.trim()) return [];
  return value
    .split(/[\n,]+/g)
    .map((route) => route.trim())
    .filter(Boolean)
    .map((route) => (route.startsWith('/') ? route : `/${route}`));
};

const validateTenantForm = (values: TenantFormState): TenantFormErrors => {
  const errors: TenantFormErrors = { hostname: '', memory: '', timeout: '' };

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

  return errors;
};

const hasErrors = (errors: TenantFormErrors) =>
  Boolean(errors.hostname || errors.memory || errors.timeout);

export default function AdminTenantsPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [form, setForm] = useState<TenantFormState>(DEFAULT_FORM);
  const [editForm, setEditForm] = useState<TenantEditState>(DEFAULT_EDIT_FORM);
  const [validationErrors, setValidationErrors] = useState<TenantFormErrors>({
    hostname: '',
    memory: '',
    timeout: '',
  });
  const [editValidationErrors, setEditValidationErrors] = useState<TenantFormErrors>({
    hostname: '',
    memory: '',
    timeout: '',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TenantSummary | null>(null);

  useEffect(() => {
    setSelectedTenant(getSelectedTenantHost());
  }, []);

  const loadTenants = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson('/api/admin/tenants', { token });
      setTenants(data.tenants || []);
    } catch (err: any) {
      setError(err.message);
      if (err.message?.toLowerCase().includes('unauthorized')) {
        setToken('');
      }
    } finally {
      setLoading(false);
    }
  };

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
        setIsAdmin(role === 'admin');
        if (role !== 'admin') {
          router.replace('/dashboard');
          return;
        }
        await loadTenants();
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    bootstrap();
  }, [token, ready, setToken, router]);

  const openCreateModal = () => {
    setForm(DEFAULT_FORM);
    setValidationErrors({ hostname: '', memory: '', timeout: '' });
    setModalOpen(true);
  };

  const closeCreateModal = () => {
    setModalOpen(false);
    setForm(DEFAULT_FORM);
    setValidationErrors({ hostname: '', memory: '', timeout: '' });
  };

  const openEditModal = (tenant: TenantSummary) => {
    setEditForm({
      id: tenant.id,
      originalHostname: tenant.hostname,
      hostname: tenant.hostname,
      isSuspended: tenant.isSuspended,
      memory: String(tenant.resourceConfig?.memory ?? Number(DEFAULT_FORM.memory)),
      timeout: String(tenant.resourceConfig?.timeout ?? Number(DEFAULT_FORM.timeout)),
      restrictRoutes: formatRoutes(tenant.restrictRoutes),
    });
    setEditValidationErrors({ hostname: '', memory: '', timeout: '' });
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditForm(DEFAULT_EDIT_FORM);
    setEditValidationErrors({ hostname: '', memory: '', timeout: '' });
  };

  const openDeleteModal = (tenant: TenantSummary) => {
    setDeleteTarget(tenant);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteModalOpen(false);
    setDeleteTarget(null);
  };

  const handleOpenEditor = (tenant: TenantSummary) => {
    setSelectedTenantHost(tenant.hostname);
    setSelectedTenant(tenant.hostname);
    router.push('/editor');
  };

  const buildPayload = (values: TenantFormState) => ({
    hostname: values.hostname.trim(),
    isSuspended: values.isSuspended,
    resourceConfig: {
      memory: Number(values.memory),
      timeout: Number(values.timeout),
    },
    restrictRoutes: parseRoutes(values.restrictRoutes),
  });

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = validateTenantForm(form);
    setValidationErrors(errors);
    if (hasErrors(errors)) return;
    if (!token) return;

    try {
      const payload = buildPayload(form);
      const data = await fetchJson('/api/admin/tenants', {
        method: 'POST',
        token,
        body: payload,
      });
      success(`Created tenant ${data?.tenant?.hostname || payload.hostname}`);
      closeCreateModal();
      await loadTenants();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const errors = validateTenantForm(editForm);
    setEditValidationErrors(errors);
    if (hasErrors(errors) || !editForm.id) return;
    if (!token) return;

    try {
      const payload = buildPayload(editForm);
      const data = await fetchJson(`/api/admin/tenants/${editForm.id}`, {
        method: 'PUT',
        token,
        body: payload,
      });
      const nextHostname = data?.tenant?.hostname || payload.hostname;
      success(`Updated tenant ${nextHostname}`);
      if (selectedTenant && editForm.originalHostname === selectedTenant) {
        if (nextHostname && nextHostname !== selectedTenant) {
          setSelectedTenantHost(nextHostname);
          setSelectedTenant(nextHostname);
        }
      }
      closeEditModal();
      await loadTenants();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!token || !deleteTarget) return;
    setError('');
    try {
      await fetchJson(`/api/admin/tenants/${deleteTarget.id}`, {
        method: 'DELETE',
        token,
      });
      success(`Deleted tenant ${deleteTarget.hostname}`);
      if (selectedTenant === deleteTarget.hostname) {
        setSelectedTenantHost('');
        setSelectedTenant('');
      }
      closeDeleteModal();
      await loadTenants();
    } catch (err: any) {
      setError(err.message);
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
        <PageHeader title="Tenants" subtitle="Create and manage tenants for the editor." />
        <DataCard title="Permission Denied" subtitle="You do not have access to tenant management.">
          <p className="text-sm text-textMuted">Please contact an administrator if you believe this is an error.</p>
        </DataCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        subtitle="Create, edit, and open tenants in the editor."
        actions={
          <Button onClick={openCreateModal} variant="primary" size="md">
            New tenant
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard
        title="Tenant list"
        subtitle="Choose a tenant, update settings, or open the editor for that tenant."
      >
        <DataTable
          headers={['Hostname', 'Status', 'Resources', 'Updated', 'Actions']}
          loading={loading}
          emptyMessage="No tenants found."
        >
          {tenants.map((tenant) => (
            <tr key={tenant.id} className="text-sm hover:bg-bgApp transition">
              <td className="px-4 py-3 text-textPrimary">
                <div className="flex items-center gap-2">
                  <span>{tenant.hostname}</span>
                  {selectedTenant === tenant.hostname && (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent">
                      selected
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-textMuted">
                {tenant.isSuspended ? 'Suspended' : 'Active'}
              </td>
              <td className="px-4 py-3 text-textMuted">
                {tenant.resourceConfig
                  ? `${tenant.resourceConfig.memory} MB / ${tenant.resourceConfig.timeout} ms`
                  : 'N/A'}
              </td>
              <td className="px-4 py-3 text-textMuted">
                {tenant.updatedAt ? new Date(tenant.updatedAt).toLocaleString() : 'N/A'}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => handleOpenEditor(tenant)}>
                    Open editor
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEditModal(tenant)}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => openDeleteModal(tenant)}>
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </DataCard>

      <Modal
        open={modalOpen}
        onClose={closeCreateModal}
        title="Create tenant"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeCreateModal}>
              Cancel
            </Button>
            <button
              onClick={(e) => {
                e.preventDefault();
              }}
              aria-hidden
              className="hidden"
            />
          </div>
        }
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <FormLayout
            gridClassName="grid gap-4 md:grid-cols-2"
            actions={
              <Button type="submit" variant="primary">
                Create tenant
              </Button>
            }
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
            <Input
              label="Memory (MB)"
              type="number"
              min="1"
              step="1"
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
            <div className="md:col-span-2">
              <TextArea
                label="Restrict routes"
                placeholder="/admin\n/secret"
                value={form.restrictRoutes}
                onChange={(e) => setForm({ ...form, restrictRoutes: e.target.value })}
              />
            </div>
          </FormLayout>
        </form>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={closeEditModal}
        title="Edit tenant"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeEditModal}>
              Cancel
            </Button>
            <button
              onClick={(e) => {
                e.preventDefault();
              }}
              aria-hidden
              className="hidden"
            />
          </div>
        }
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <FormLayout
            gridClassName="grid gap-4 md:grid-cols-2"
            actions={
              <Button type="submit" variant="primary">
                Save changes
              </Button>
            }
          >
            <div className="md:col-span-2">
              <Input
                label="Hostname"
                placeholder="tenant.example.com"
                value={editForm.hostname}
                onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })}
                error={editValidationErrors.hostname}
              />
            </div>
            <label className="flex items-center gap-2 pt-6 text-sm text-textPrimary">
              <input
                type="checkbox"
                checked={editForm.isSuspended}
                onChange={(e) => setEditForm({ ...editForm, isSuspended: e.target.checked })}
                className="h-4 w-4 rounded border-borderSubtle text-accent focus:ring-accent/30"
              />
              Suspended
            </label>
            <Input
              label="Memory (MB)"
              type="number"
              min="1"
              step="1"
              value={editForm.memory}
              onChange={(e) => setEditForm({ ...editForm, memory: e.target.value })}
              error={editValidationErrors.memory}
            />
            <Input
              label="Timeout (ms)"
              type="number"
              min="1"
              step="100"
              value={editForm.timeout}
              onChange={(e) => setEditForm({ ...editForm, timeout: e.target.value })}
              error={editValidationErrors.timeout}
            />
            <div className="md:col-span-2">
              <TextArea
                label="Restrict routes"
                placeholder="/admin\n/secret"
                value={editForm.restrictRoutes}
                onChange={(e) => setEditForm({ ...editForm, restrictRoutes: e.target.value })}
              />
            </div>
          </FormLayout>
        </form>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title="Delete tenant"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDeleteModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete tenant
            </Button>
          </div>
        }
      >
        <p className="text-sm text-textMuted">
          {deleteTarget
            ? `Delete ${deleteTarget.hostname}? This will remove accounts, secrets, and modules for that tenant.`
            : 'Select a tenant to delete.'}
        </p>
      </Modal>
    </div>
  );
}
