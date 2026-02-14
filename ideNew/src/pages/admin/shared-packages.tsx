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

type SharedProject = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  dependencies: string[];
  fileExtension: string;
  ownerTeamId?: number;
  editorTeamIds?: number[];
  canEdit?: boolean;
  canPublish?: boolean;
  canManageAccess?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export default function AdminSharedPackagesPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [canCreate, setCanCreate] = useState(false);
  const pageSize = 20;
  const [projects, setProjects] = useState<SharedProject[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SharedProject | null>(null);

  const loadProjects = async (targetPage = 1, append = false) => {
    if (!token) return;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      const data = await fetchJson(
        `/api/admin/shared-packages?page=${targetPage}&limit=${pageSize}`,
        { token }
      );
      const nextProjects = data.packages || [];
      setProjects((prev) => (append ? [...prev, ...nextProjects] : nextProjects));
      setPage(data.page ?? targetPage);
      setTotal(typeof data.total === 'number' ? data.total : nextProjects.length);
      setCanCreate(Boolean(data.canCreate));
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
        setIsAdmin(hasPermissionFromUser(meData.user, 'ide.shared_ui.read'));
        if (!hasPermissionFromUser(meData.user, 'ide.shared_ui.read')) {
          router.replace('/dashboard');
          return;
        }
        await loadProjects(1, false);
      } catch (err: any) {
        setError(err.message);
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    bootstrap();
  }, [token, ready, setToken, router]);

  const confirmDelete = (project: SharedProject) => {
    setDeleteTarget(project);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    setDeleteModalOpen(false);
  };

  const handleDelete = async () => {
    if (!token || !deleteTarget) return;
    setError('');
    try {
      await fetchJson(`/api/admin/shared-packages/${deleteTarget.id}`, {
        method: 'DELETE',
        token,
      });
      success(`Deleted ${deleteTarget.name}`);
      closeDeleteModal();
      await loadProjects(1, false);
    } catch (err: any) {
      showError(err.message || 'Failed to delete shared project');
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
        <PageHeader title="Admin: Shared Projects" subtitle="Create shared UI projects usable by any tenant." />
        <DataCard title="Permission Denied" subtitle="You do not have access to shared projects.">
          <p className="text-sm text-textMuted">Please contact an administrator if you believe this is an error.</p>
        </DataCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin: Shared Projects"
        subtitle="Create shared UI projects usable by any tenant."
        actions={canCreate ? (
          <Button href="/admin/shared-packages/new" variant="primary" size="md">
            New shared project
          </Button>
        ) : undefined}
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard
        title="Shared projects"
        subtitle={`Showing ${projects.length} of ${total} projects`}
      >
        <div className="space-y-4">
          <DataTable
            headers={['Name', 'Version', 'Entry', 'Updated', 'Actions']}
            loading={loading}
            emptyMessage="No shared projects yet."
          >
            {projects.map((project) => (
              <tr key={project.id} className="text-sm hover:bg-bgApp transition">
                <td className="px-4 py-3 text-textPrimary">{project.name}</td>
                <td className="px-4 py-3 text-textMuted">{project.version}</td>
                <td className="px-4 py-3 text-textMuted">{project.entryPath}</td>
                <td className="px-4 py-3 text-textMuted">
                  {project.updatedAt ? new Date(project.updatedAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      href={`/editor?sharedProject=${project.id}`}
                    >
                      Open editor
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      href={`/admin/shared-packages/${project.id}`}
                      disabled={!project.canEdit}
                    >
                      Edit
                    </Button>
                    {project.canEdit ? (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => confirmDelete(project)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
          <div className="flex items-center justify-between text-xs text-textMuted">
            <span>
              Page {page} · {total} total
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={loadingMore || projects.length >= total}
              onClick={() => loadProjects(page + 1, true)}
            >
              {loadingMore ? 'Loading…' : projects.length >= total ? 'No more' : 'Load more'}
            </Button>
          </div>
        </div>
      </DataCard>

      <Modal
        open={deleteModalOpen}
        onClose={closeDeleteModal}
        title="Delete shared project"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeDeleteModal}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete project
            </Button>
          </div>
        }
      >
        <p className="text-sm text-textMuted">
          {deleteTarget
            ? `Delete ${deleteTarget.name}? This will remove all files and versions for that project.`
            : 'Select a project to delete.'}
        </p>
      </Modal>
    </div>
  );
}
