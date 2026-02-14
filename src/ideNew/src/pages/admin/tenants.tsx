import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import { hasPermissionFromUser } from '@/lib/client/access';
import { getSelectedTenantHost, setSelectedTenantHost } from '@/lib/client/tenant';

type TenantSummary = {
  id: string;
  hostname: string;
  canWrite?: boolean;
  isSuspended: boolean;
  allowRegistration?: boolean;
  resourceConfig?: { memory: number; timeout: number };
  adapterAccess?: Record<string, { allow: string[] }>;
  adapterConfig?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export default function AdminTenantsPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success } = useToast();
  const [canReadTenants, setCanReadTenants] = useState<boolean | null>(null);
  const [canCreateTenants, setCanCreateTenants] = useState(false);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;
  const [selectedTenant, setSelectedTenant] = useState('');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TenantSummary | null>(null);

  useEffect(() => {
    setSelectedTenant(getSelectedTenantHost());
  }, []);

  const loadTenants = async (targetPage = 1, append = false) => {
    if (!token) return;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const data = await fetchJson(
        `/api/admin/tenants?page=${targetPage}&limit=${pageSize}`,
        { token }
      );
      const nextTenants = data.tenants || [];
      setTenants((prev) => (append ? [...prev, ...nextTenants] : nextTenants));
      setPage(data.page ?? targetPage);
      setTotal(typeof data.total === 'number' ? data.total : nextTenants.length);
      setCanCreateTenants(Boolean(data.canCreate));
    } catch (err: any) {
      setError(err.message);
      if (err.message?.toLowerCase().includes('unauthorized')) {
        setToken('');
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
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
        const canRead = hasPermissionFromUser(meData.user, 'ide.tenants.read');
        setCanReadTenants(canRead);
        if (!canRead) {
          router.replace('/dashboard');
          return;
        }
        await loadTenants(1, false);
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    bootstrap();
  }, [token, ready, setToken, router]);

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
      await loadTenants(1, false);
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

  if (canReadTenants === false) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tenants" subtitle="View tenant assignments for your active team." />
        <DataCard title="Permission Denied" subtitle="You do not have access to tenant views.">
          <p className="text-sm text-textMuted">Please contact an administrator if you believe this is an error.</p>
        </DataCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        subtitle="View and manage tenants assigned to your active team."
        actions={canCreateTenants ? (
          <Button href="/admin/tenants/new" variant="primary" size="md">
            New tenant
          </Button>
        ) : undefined}
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard
        title="Tenant list"
        subtitle={`Showing ${tenants.length} of ${total} tenants`}
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
                  {tenant.canWrite ? (
                    <Button variant="secondary" size="sm" href={`/admin/tenants/${tenant.id}`}>
                      Edit
                    </Button>
                  ) : null}
                  {canCreateTenants ? (
                    <Button variant="danger" size="sm" onClick={() => openDeleteModal(tenant)}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="mt-4 flex items-center justify-between text-xs text-textMuted">
          <span>
            Page {page} · {total} total
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingMore || tenants.length >= total}
            onClick={() => loadTenants(page + 1, true)}
          >
            {loadingMore ? 'Loading…' : tenants.length >= total ? 'No more' : 'Load more'}
          </Button>
        </div>
      </DataCard>

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
