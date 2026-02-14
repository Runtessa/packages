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
  canManageAccess?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type TeamOption = {
  id: number;
  key: string;
  name: string;
  isActive?: boolean;
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

export default function AdminSharedPackageEditPage() {
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
  const [canEditProject, setCanEditProject] = useState(true);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [ownerTeamId, setOwnerTeamId] = useState<number | ''>('');
  const [editorTeamIds, setEditorTeamIds] = useState<number[]>([]);
  const [canManageAccess, setCanManageAccess] = useState(false);
  const [canChangeOwner, setCanChangeOwner] = useState(false);
  const [savingAccess, setSavingAccess] = useState(false);

  const idRaw = router.query.id;
  const projectId = Array.isArray(idRaw) ? idRaw[0] : idRaw;

  const loadAccess = async () => {
    if (!token || !projectId) return;
    const payload = await fetchJson(`/api/admin/shared-packages/${projectId}/access`, { token });
    const access = payload?.access ?? {};
    const teams = Array.isArray(payload?.teams) ? payload.teams : [];
    setTeamOptions(teams);
    setOwnerTeamId(Number.isInteger(access.ownerTeamId) ? access.ownerTeamId : '');
    setEditorTeamIds(
      Array.isArray(access.editorTeamIds)
        ? access.editorTeamIds.filter((entry: unknown) => Number.isInteger(Number(entry))).map(Number)
        : []
    );
    setCanManageAccess(Boolean(access.canManage));
    setCanChangeOwner(Boolean(access.canChangeOwner));
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
        setIsAdmin(hasPermissionFromUser(meData.user, 'ide.shared_ui.write'));
        if (!hasPermissionFromUser(meData.user, 'ide.shared_ui.write')) {
          router.replace('/dashboard');
          return;
        }
        const payload = await fetchJson(`/api/admin/shared-packages/${projectId}`, { token });
        const project = (payload?.package ?? payload) as SharedProject | undefined;
        if (!project) {
          setError('Shared project not found');
          return;
        }
        setForm({
          name: project.name,
          version: project.version,
          entryPath: project.entryPath || 'src/index.jsx',
          fileExtension: project.fileExtension || 'jsx',
          dependencies: formatDeps(project.dependencies),
        });
        setCanEditProject(project.canEdit !== false);
        await loadAccess();
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
    if (hasErrors(errors) || !projectId || !canEditProject) return;

    try {
      const deps = parseDeps(form.dependencies);
      await fetchJson(`/api/admin/shared-packages/${projectId}`, {
        method: 'PUT',
        token,
        body: {
          name: form.name,
          version: form.version,
          entryPath: form.entryPath,
          dependencies: deps,
          fileExtension: form.fileExtension || 'jsx',
        },
      });
      success('Shared project updated');
      router.push('/admin/shared-packages');
    } catch (err: any) {
      showError(err.message || 'Failed to update shared project');
    }
  };

  const toggleEditorTeam = (teamId: number, checked: boolean) => {
    setEditorTeamIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(teamId);
      } else {
        next.delete(teamId);
      }
      return Array.from(next).sort((a, b) => a - b);
    });
  };

  const handleSaveAccess = async () => {
    if (!token || !projectId || !canManageAccess) return;
    setSavingAccess(true);
    try {
      await fetchJson(`/api/admin/shared-packages/${projectId}/access`, {
        method: 'PUT',
        token,
        body: {
          ownerTeamId: ownerTeamId === '' ? null : ownerTeamId,
          editorTeamIds,
        },
      });
      success('Shared package access updated');
      await loadAccess();
    } catch (err: any) {
      showError(err.message || 'Failed to update access');
    } finally {
      setSavingAccess(false);
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
        <PageHeader title="Edit shared project" subtitle="You do not have access to shared projects." />
        <DataCard title="Permission Denied" subtitle="Please contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit shared project"
        subtitle={form.name ? `Update ${form.name}` : 'Update shared project settings.'}
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

      <DataCard title="Project details" subtitle="Update package metadata.">
        {loading ? (
          <div className="text-sm text-textMuted">Loading project…</div>
        ) : (
          <FormLayout
            onSubmit={handleSubmit}
            gridClassName="grid gap-4 md:grid-cols-2"
            actions={
              <>
                <Button variant="secondary" href="/admin/shared-packages">
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!canEditProject}>
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
        )}
        {!canEditProject ? (
          <p className="mt-3 text-xs text-textMuted">
            Read-only view: this shared package is outside your owner/granted team scope.
          </p>
        ) : null}
      </DataCard>

      <DataCard
        title="Team access"
        subtitle="Owner team can publish. Owner tenant admins can grant edit access to other teams."
      >
        <div className="space-y-4">
          <Select
            label="Owner team"
            value={ownerTeamId === '' ? '' : String(ownerTeamId)}
            options={[
              { label: 'Unassigned', value: '' },
              ...teamOptions.map((team) => ({
                label: `${team.name} (${team.key})`,
                value: String(team.id),
              })),
            ]}
            disabled={!canManageAccess || !canChangeOwner}
            onChange={(event) => {
              const value = event.target.value;
              const parsed = Number(value);
              setOwnerTeamId(Number.isInteger(parsed) && parsed > 0 ? parsed : '');
            }}
          />
          <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-textMuted">Editor teams</div>
            <div className="grid gap-2 md:grid-cols-2">
              {teamOptions.length === 0 ? (
                <div className="text-sm text-textMuted">No active teams available.</div>
              ) : (
                teamOptions.map((team) => {
                  const isOwner = ownerTeamId !== '' && Number(ownerTeamId) === team.id;
                  const checked = isOwner || editorTeamIds.includes(team.id);
                  return (
                    <label
                      key={team.id}
                      className="flex items-center gap-2 rounded border border-borderSubtle px-2 py-1.5 text-sm text-textPrimary"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canManageAccess || isOwner}
                        onChange={(event) => toggleEditorTeam(team.id, event.target.checked)}
                      />
                      <span>{team.name}</span>
                      <span className="text-xs text-textMuted">({team.key})</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={handleSaveAccess}
              disabled={!canManageAccess || savingAccess}
            >
              {savingAccess ? 'Saving…' : 'Save access'}
            </Button>
          </div>
          {!canManageAccess ? (
            <p className="text-xs text-textMuted">
              Access management is restricted to owner team tenant admins or platform admins.
            </p>
          ) : null}
        </div>
      </DataCard>
    </div>
  );
}
