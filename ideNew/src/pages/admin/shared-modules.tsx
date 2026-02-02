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
  { label: 'JS', value: 'js' },
  { label: 'TS', value: 'ts' },
  { label: 'JSX', value: 'jsx' },
  { label: 'TSX', value: 'tsx' },
  { label: 'JSON', value: 'json' },
];

const DEFAULT_FORM: ProjectFormState = {
  name: '',
  version: '1.0.0',
  entryPath: 'src/index.ts',
  fileExtension: 'ts',
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

export default function AdminSharedModulesPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();
  const { success, error: showError } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<SharedModuleProject[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SharedModuleProject | null>(null);
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

  const loadProjects = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchJson('/api/admin/shared-modules', { token });
      setProjects(data.packages || []);
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
        const normalizedRole = String(meData?.user?.role || '').toLowerCase();
        const admin = Boolean(meData?.user?.isAdmin ?? normalizedRole === 'admin');
        setIsAdmin(admin);
        if (!admin) {
          router.replace('/dashboard');
          return;
        }
        await loadProjects();
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

  const openEditModal = (project: SharedModuleProject) => {
    setEditTargetId(project.id);
    setEditForm({
      name: project.name,
      version: project.version,
      entryPath: project.entryPath || 'src/index.ts',
      fileExtension: project.fileExtension || 'ts',
      dependencies: formatDeps(project.dependencies),
    });
    setEditValidationErrors({ name: '', version: '', entryPath: '' });
    setEditModalOpen(true);
  };

  const confirmDelete = (project: SharedModuleProject) => {
    setDeleteTarget(project);
    setDeleteModalOpen(true);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const errors = validateForm(form);
    setValidationErrors(errors);
    if (hasErrors(errors)) return;
    try {
      const payload = {
        name: form.name.trim(),
        version: form.version.trim(),
        entryPath: form.entryPath.trim(),
        fileExtension: form.fileExtension,
        dependencies: parseDeps(form.dependencies),
      };
      await fetchJson('/api/admin/shared-modules', { token, method: 'POST', body: payload });
      success('Shared backend project created');
      setModalOpen(false);
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
      showError(err.message);
    }
  };

  const handleEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editTargetId) return;
    setError('');
    const errors = validateForm(editForm);
    setEditValidationErrors(errors);
    if (hasErrors(errors)) return;
    try {
      const payload = {
        name: editForm.name.trim(),
        version: editForm.version.trim(),
        entryPath: editForm.entryPath.trim(),
        fileExtension: editForm.fileExtension,
        dependencies: parseDeps(editForm.dependencies),
      };
      await fetchJson(`/api/admin/shared-modules/${editTargetId}`, {
        token,
        method: 'PUT',
        body: payload,
      });
      success('Shared backend project updated');
      setEditModalOpen(false);
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
      showError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setError('');
    try {
      await fetchJson(`/api/admin/shared-modules/${deleteTarget.id}`, {
        token,
        method: 'DELETE',
      });
      success('Shared backend project deleted');
      setDeleteModalOpen(false);
      setDeleteTarget(null);
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
      showError(err.message);
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
        title="Admin: Shared Backend Projects"
        subtitle="Create shared backend libraries usable by any tenant."
        actions={
          <Button onClick={openCreateModal} variant="primary" size="md">
            New shared backend project
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <DataCard
        title="Shared backend projects"
        subtitle={`Total ${projects.length} project${projects.length === 1 ? '' : 's'}`}
      >
        <div className="space-y-4">
          <DataTable
            headers={['Name', 'Version', 'Entry', 'Updated', 'Actions']}
            loading={loading}
            emptyMessage="No shared backend projects yet."
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
                      href={`/editor?sharedModule=${project.id}`}
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
        </div>
      </DataCard>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create shared backend project"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreate}>
              Create
            </Button>
          </div>
        }
      >
        <FormLayout onSubmit={handleCreate}>
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
            placeholder="src/index.ts"
          />
          <Select
            label="File extension"
            value={form.fileExtension}
            onChange={(event) => setForm({ ...form, fileExtension: event.target.value })}
            options={FILE_EXTENSION_OPTIONS}
          />
          <TextArea
            label="Dependencies (one per line)"
            value={form.dependencies}
            onChange={(event) => setForm({ ...form, dependencies: event.target.value })}
            rows={4}
          />
        </FormLayout>
      </Modal>

      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit shared backend project"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleEdit}>
              Save changes
            </Button>
          </div>
        }
      >
        <FormLayout onSubmit={handleEdit}>
          <Input
            label="Name"
            value={editForm.name}
            onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
            error={editValidationErrors.name}
          />
          <Input
            label="Version"
            value={editForm.version}
            onChange={(event) => setEditForm({ ...editForm, version: event.target.value })}
            error={editValidationErrors.version}
          />
          <Input
            label="Entry file"
            value={editForm.entryPath}
            onChange={(event) => setEditForm({ ...editForm, entryPath: event.target.value })}
            error={editValidationErrors.entryPath}
          />
          <Select
            label="File extension"
            value={editForm.fileExtension}
            onChange={(event) => setEditForm({ ...editForm, fileExtension: event.target.value })}
            options={FILE_EXTENSION_OPTIONS}
          />
          <TextArea
            label="Dependencies (one per line)"
            value={editForm.dependencies}
            onChange={(event) =>
              setEditForm({ ...editForm, dependencies: event.target.value })
            }
            rows={4}
          />
        </FormLayout>
      </Modal>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete shared backend project?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        }
      >
        <p className="text-sm text-textMuted">
          This will permanently delete{' '}
          <span className="font-semibold text-textPrimary">{deleteTarget?.name}</span>.
        </p>
      </Modal>
    </div>
  );
}
