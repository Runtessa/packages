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

type SharedProject = {
  id: string;
  name: string;
  version: string;
  entryPath: string;
  dependencies: string[];
  fileExtension: string;
  createdAt?: string;
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
  const pageSize = 20;
  const [projects, setProjects] = useState<SharedProject[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SharedProject | null>(null);
  const [form, setForm] = useState<ProjectFormState>(DEFAULT_FORM);
  const [editForm, setEditForm] = useState<ProjectFormState>(DEFAULT_FORM);
  const [editTargetId, setEditTargetId] = useState('');
  const [validationErrors, setValidationErrors] = useState<ProjectFormErrors>({
    name: '',
    version: '',
    entryPath: '',
  });
  const [editValidationErrors, setEditValidationErrors] = useState<ProjectFormErrors>({
    name: '',
    version: '',
    entryPath: '',
  });

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
        const role = meData?.user?.role;
        setIsAdmin(role === 'admin');
        if (role !== 'admin') {
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

  const openCreateModal = () => {
    setForm(DEFAULT_FORM);
    setValidationErrors({ name: '', version: '', entryPath: '' });
    setModalOpen(true);
  };

  const openEditModal = (project: SharedProject) => {
    setEditTargetId(project.id);
    setEditForm({
      name: project.name,
      version: project.version,
      entryPath: project.entryPath || 'src/index.jsx',
      fileExtension: project.fileExtension || 'jsx',
      dependencies: formatDeps(project.dependencies),
    });
    setEditValidationErrors({ name: '', version: '', entryPath: '' });
    setEditModalOpen(true);
  };

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
      setModalOpen(false);
      setForm(DEFAULT_FORM);
      await loadProjects(1, false);
    } catch (err: any) {
      showError(err.message || 'Failed to create shared project');
    }
  };

  const handleEditSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const errors = validateForm(editForm);
    setEditValidationErrors(errors);
    if (hasErrors(errors)) return;

    try {
      const deps = parseDeps(editForm.dependencies);
      await fetchJson(`/api/admin/shared-packages/${editTargetId}`, {
        method: 'PUT',
        token,
        body: {
          name: editForm.name,
          version: editForm.version,
          entryPath: editForm.entryPath,
          dependencies: deps,
          fileExtension: editForm.fileExtension || 'jsx',
        },
      });
      success('Shared project updated');
      setEditModalOpen(false);
      setEditTargetId('');
      await loadProjects(1, false);
    } catch (err: any) {
      showError(err.message || 'Failed to update shared project');
    }
  };

  const confirmDelete = (project: SharedProject) => {
    setDeleteTarget(project);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetchJson(`/api/admin/shared-packages/${deleteTarget.id}`, {
        method: 'DELETE',
        token,
      });
      success('Shared project deleted');
      setDeleteModalOpen(false);
      setDeleteTarget(null);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin: Shared Projects"
        subtitle="Create shared UI projects usable by any tenant."
        actions={
          <Button onClick={openCreateModal} variant="primary" size="md">
            New shared project
          </Button>
        }
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
                      onClick={() => openEditModal(project)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => confirmDelete(project)}
                    >
                      Delete
                    </Button>
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create shared project"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form="create-shared-project-form">
              Create project
            </Button>
          </>
        }
      >
        <form id="create-shared-project-form" onSubmit={handleSubmit} className="space-y-4">
          <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Input
                label="Project name"
                value={form.name}
                error={validationErrors.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="@shared/ui"
              />
            </div>
            <Input
              label="Version"
              value={form.version}
              error={validationErrors.version}
              onChange={(e) => setForm((prev) => ({ ...prev, version: e.target.value }))}
              placeholder="1.0.0"
            />
            <Select
              label="File extension"
              value={form.fileExtension}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, fileExtension: e.target.value }))
              }
              options={FILE_EXTENSION_OPTIONS}
            />
            <div className="md:col-span-2">
              <Input
                label="Entry file"
                value={form.entryPath}
                error={validationErrors.entryPath}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, entryPath: e.target.value }))
                }
                placeholder="src/index.jsx"
              />
            </div>
            <div className="md:col-span-2">
              <TextArea
                label="Dependencies"
                value={form.dependencies}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, dependencies: e.target.value }))
                }
                placeholder="@shared/tokens\n@shared/icons"
                rows={3}
              />
            </div>
          </FormLayout>
        </form>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit shared project"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" form="edit-shared-project-form">
              Save changes
            </Button>
          </>
        }
      >
        <form id="edit-shared-project-form" onSubmit={handleEditSubmit} className="space-y-4">
          <FormLayout gridClassName="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Input
                label="Project name"
                value={editForm.name}
                error={editValidationErrors.name}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="@shared/ui"
              />
            </div>
            <Input
              label="Version"
              value={editForm.version}
              error={editValidationErrors.version}
              onChange={(e) =>
                setEditForm((prev) => ({ ...prev, version: e.target.value }))
              }
              placeholder="1.0.0"
            />
            <Select
              label="File extension"
              value={editForm.fileExtension}
              onChange={(e) =>
                setEditForm((prev) => ({ ...prev, fileExtension: e.target.value }))
              }
              options={FILE_EXTENSION_OPTIONS}
            />
            <div className="md:col-span-2">
              <Input
                label="Entry file"
                value={editForm.entryPath}
                error={editValidationErrors.entryPath}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, entryPath: e.target.value }))
                }
                placeholder="src/index.jsx"
              />
            </div>
            <div className="md:col-span-2">
              <TextArea
                label="Dependencies"
                value={editForm.dependencies}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, dependencies: e.target.value }))
                }
                placeholder="@shared/tokens\n@shared/icons"
                rows={3}
              />
            </div>
          </FormLayout>
        </form>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete shared project?"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-sm text-textMuted">
          <p>
            This will remove{' '}
            <span className="font-semibold text-textPrimary">{deleteTarget?.name}</span>{' '}
            <span className="text-textPrimary">@{deleteTarget?.version}</span> from the shared registry.
          </p>
          <p>Tenants depending on it will fail to load until replaced.</p>
        </div>
      </Modal>
    </div>
  );
}
