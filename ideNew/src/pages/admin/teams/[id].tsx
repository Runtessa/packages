import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { FormLayout } from '@/components/ui/FormLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useAdminGuard } from '@/lib/client/use-admin-guard';
import { AccessTabs } from '@/components/admin/AccessTabs';
import { IDE_ROLE_LABELS } from '@/lib/rbac';
import {
  TEAM_ROLE_ORDER,
  TEAM_ROLE_LABELS,
  addTeamMember,
  deleteTeam,
  fetchTeamDetail,
  fetchTeamUsers,
  fetchTeamTenants,
  removeTeamMember,
  assignTeamTenant,
  unassignTeamTenant,
  updateTeam,
  updateTeamMemberRole,
  type TeamDetailPayload,
  type TeamRole,
  type TeamTenantOption,
  type TeamUserOption,
} from '@/lib/client/teams-admin';

const ROLE_INDEX = TEAM_ROLE_ORDER.reduce((acc, role, index) => {
  acc[role] = index;
  return acc;
}, {} as Record<string, number>);

const toRole = (value: string): TeamRole =>
  (TEAM_ROLE_ORDER.includes(value as TeamRole) ? (value as TeamRole) : 'observer');

const shiftRole = (currentRole: string, direction: -1 | 1): TeamRole => {
  const currentIndex = ROLE_INDEX[currentRole] ?? ROLE_INDEX.observer;
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), TEAM_ROLE_ORDER.length - 1);
  return TEAM_ROLE_ORDER[nextIndex];
};

const parseTeamId = (raw: unknown): number | null => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatDate = (value?: string) => {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export default function AdminTeamDetailPage() {
  const router = useRouter();
  const teamId = parseTeamId(router.query.id);
  const { token, ready, isAdmin, loading: authLoading, error: authError } = useAdminGuard('ide.users.manage');

  const [teamDetail, setTeamDetail] = useState<TeamDetailPayload | null>(null);
  const [users, setUsers] = useState<TeamUserOption[]>([]);
  const [tenants, setTenants] = useState<TeamTenantOption[]>([]);
  const [tenantIdToAssign, setTenantIdToAssign] = useState('');
  const [memberRoleDraft, setMemberRoleDraft] = useState<Record<number, TeamRole>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editForm, setEditForm] = useState({
    name: '',
    key: '',
    description: '',
    isActive: true,
  });
  const [memberForm, setMemberForm] = useState({
    userId: '',
    role: 'observer' as TeamRole,
  });

  const loadUsers = async () => {
    if (!token) return;
    try {
      const rows = await fetchTeamUsers(token);
      setUsers(rows.sort((a: TeamUserOption, b: TeamUserOption) => a.email.localeCompare(b.email)));
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    }
  };

  const loadTeamDetail = async (options?: { silent?: boolean }) => {
    if (!token || !teamId) return;
    if (!options?.silent) {
      setDetailLoading(true);
      setError('');
    }
    try {
      const detail = await fetchTeamDetail(token, teamId);
      setTeamDetail(detail);
      setEditForm({
        name: detail.team.name || '',
        key: detail.team.key || '',
        description: detail.team.description || '',
        isActive: Boolean(detail.team.isActive),
      });
      const drafts: Record<number, TeamRole> = {};
      detail.members.forEach((member) => {
        drafts[member.id] = toRole(String(member.teamRole || 'observer'));
      });
      setMemberRoleDraft(drafts);
    } catch (err: any) {
      setError(err.message || 'Failed to load team details');
      setTeamDetail(null);
    } finally {
      if (!options?.silent) setDetailLoading(false);
    }
  };

  const loadTeamTenants = async () => {
    if (!token || !teamId) return;
    try {
      const data = await fetchTeamTenants(token, teamId);
      const rows = Array.isArray(data?.tenants) ? data.tenants : [];
      setTenants(rows);
      const firstAvailable = rows.find((entry) => !entry.assigned);
      const stillAvailable = rows.some(
        (entry) => !entry.assigned && entry.id === tenantIdToAssign
      );
      if (stillAvailable) return;
      setTenantIdToAssign(firstAvailable?.id || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load tenant assignments');
    }
  };

  useEffect(() => {
    if (!ready || !token || !isAdmin || !teamId) return;
    void Promise.all([loadTeamDetail(), loadUsers(), loadTeamTenants()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, isAdmin, teamId]);

  const selectedMemberIds = useMemo(
    () => new Set((teamDetail?.members || []).map((member) => member.userId)),
    [teamDetail?.members]
  );

  const availableUsers = useMemo(
    () => users.filter((entry) => !selectedMemberIds.has(entry.id)),
    [users, selectedMemberIds]
  );

  const assignedTenants = useMemo(
    () => tenants.filter((entry) => entry.assigned),
    [tenants]
  );

  const availableTenants = useMemo(
    () => tenants.filter((entry) => !entry.assigned),
    [tenants]
  );

  const handleSaveTeam = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !teamId) return;
    if (!editForm.name.trim()) {
      setError('Team name is required');
      return;
    }

    setBusyAction('save-team');
    setError('');
    setSuccess('');
    try {
      const result = await updateTeam(token, teamId, {
        name: editForm.name.trim(),
        key: editForm.key.trim(),
        description: editForm.description.trim() || null,
        isActive: editForm.isActive,
      });
      setSuccess(`Team "${result.team.name}" updated`);
      await loadTeamDetail({ silent: true });
    } catch (err: any) {
      setError(err.message || 'Failed to update team');
    } finally {
      setBusyAction('');
    }
  };

  const handleDeleteTeam = async () => {
    if (!token || !teamId || !teamDetail?.team) return;
    const confirmed = window.confirm(`Delete team "${teamDetail.team.name}"? This removes all memberships.`);
    if (!confirmed) return;

    setBusyAction('delete-team');
    setError('');
    setSuccess('');
    try {
      await deleteTeam(token, teamId);
      router.push('/admin/teams');
    } catch (err: any) {
      setError(err.message || 'Failed to delete team');
    } finally {
      setBusyAction('');
    }
  };

  const handleAddMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !teamId) return;
    const userId = Number(memberForm.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      setError('Select a user to add');
      return;
    }

    setBusyAction('add-member');
    setError('');
    setSuccess('');
    try {
      await addTeamMember(token, teamId, {
        userId,
        role: memberForm.role,
      });
      setSuccess('Member added to team');
      setMemberForm({ userId: '', role: 'observer' });
      await loadTeamDetail({ silent: true });
    } catch (err: any) {
      setError(err.message || 'Failed to add member');
    } finally {
      setBusyAction('');
    }
  };

  const handleSetMemberRole = async (memberId: number, role: TeamRole) => {
    if (!token || !teamId) return;
    setBusyAction(`member-role:${memberId}`);
    setError('');
    setSuccess('');
    try {
      await updateTeamMemberRole(token, teamId, memberId, { role });
      setSuccess('Team role updated');
      await loadTeamDetail({ silent: true });
    } catch (err: any) {
      setError(err.message || 'Failed to update team role');
    } finally {
      setBusyAction('');
    }
  };

  const handlePromoteDemoteMember = async (memberId: number, currentRole: string, direction: -1 | 1) => {
    const nextRole = shiftRole(currentRole, direction);
    if (nextRole === currentRole) return;
    setMemberRoleDraft((prev) => ({ ...prev, [memberId]: nextRole }));
    await handleSetMemberRole(memberId, nextRole);
  };

  const handleRemoveMember = async (memberId: number, email?: string | null) => {
    if (!token || !teamId) return;
    const confirmed = window.confirm(`Remove ${email || 'this user'} from team?`);
    if (!confirmed) return;

    setBusyAction(`member-remove:${memberId}`);
    setError('');
    setSuccess('');
    try {
      await removeTeamMember(token, teamId, memberId);
      setSuccess('Member removed');
      await loadTeamDetail({ silent: true });
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    } finally {
      setBusyAction('');
    }
  };

  const handleAssignTenant = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !teamId || !tenantIdToAssign) return;
    setBusyAction('assign-tenant');
    setError('');
    setSuccess('');
    try {
      await assignTeamTenant(token, teamId, tenantIdToAssign);
      setSuccess('Tenant assigned to team');
      await loadTeamTenants();
    } catch (err: any) {
      setError(err.message || 'Failed to assign tenant');
    } finally {
      setBusyAction('');
    }
  };

  const handleUnassignTenant = async (tenantId: string, hostname: string) => {
    if (!token || !teamId) return;
    const confirmed = window.confirm(`Remove tenant "${hostname}" from this team?`);
    if (!confirmed) return;
    setBusyAction(`unassign-tenant:${tenantId}`);
    setError('');
    setSuccess('');
    try {
      await unassignTeamTenant(token, teamId, tenantId);
      setSuccess('Tenant removed from team');
      await loadTeamTenants();
    } catch (err: any) {
      setError(err.message || 'Failed to remove tenant');
    } finally {
      setBusyAction('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={teamDetail?.team?.name || 'Team Details'}
        subtitle="Manage team profile, members, and role assignments."
        actions={
          <div className="flex items-center gap-2">
            <Button href="/admin/teams" variant="secondary" size="sm">
              Teams
            </Button>
            <Button href="/admin/teams/new" variant="secondary" size="sm">
              New Team
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void loadTeamDetail()}>
              Refresh
            </Button>
          </div>
        }
      />
      <AccessTabs />

      {authLoading || detailLoading ? <DataCard title="Loading team" subtitle="Please wait..." /> : null}
      {authError ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{authError}</div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-borderSubtle bg-bgSurface px-4 py-3 text-sm text-textPrimary">
          {success}
        </div>
      ) : null}

      {!teamId ? (
        <DataCard title="Invalid team id" subtitle="Open a valid team from the teams directory." />
      ) : teamDetail ? (
        <>
          <DataCard title="Team Settings" subtitle="Edit team profile and lifecycle state.">
            <FormLayout
              onSubmit={handleSaveTeam}
              gridClassName="grid gap-4 md:grid-cols-2"
              actions={
                <>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={Boolean(busyAction)}
                    onClick={handleDeleteTeam}
                  >
                    {busyAction === 'delete-team' ? 'Deleting...' : 'Delete Team'}
                  </Button>
                  <Button type="submit" variant="primary" disabled={Boolean(busyAction)}>
                    {busyAction === 'save-team' ? 'Saving...' : 'Save Changes'}
                  </Button>
                </>
              }
            >
              <Input
                label="Team Name"
                value={editForm.name}
                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
              <Input
                label="Team Key"
                value={editForm.key}
                onChange={(event) => setEditForm((prev) => ({ ...prev, key: event.target.value }))}
                required
              />
              <div className="md:col-span-2">
                <TextArea
                  label="Description"
                  value={editForm.description}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                  rows={4}
                />
              </div>
              <label className="inline-flex items-center gap-2 rounded-lg border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary">
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                Team is active
              </label>
              <div className="rounded-lg border border-borderSubtle bg-bgApp px-3 py-2 text-xs text-textMuted">
                Created: {formatDate(teamDetail.team.createdAt)}
              </div>
            </FormLayout>
          </DataCard>

          <DataCard title="Team Members" subtitle="Add users, promote/demote team roles, and remove memberships.">
            <div className="space-y-4">
              <form className="grid gap-3 md:grid-cols-3" onSubmit={handleAddMember}>
                <Select
                  label="User"
                  value={memberForm.userId}
                  onChange={(event) =>
                    setMemberForm((prev) => ({ ...prev, userId: String(event.target.value) }))
                  }
                >
                  <option value="">Select user</option>
                  {availableUsers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.email} ({IDE_ROLE_LABELS[entry.role as keyof typeof IDE_ROLE_LABELS] || entry.role})
                    </option>
                  ))}
                </Select>
                <Select
                  label="Team Role"
                  value={memberForm.role}
                  onChange={(event) =>
                    setMemberForm((prev) => ({ ...prev, role: toRole(String(event.target.value)) }))
                  }
                  options={TEAM_ROLE_ORDER.map((role) => ({
                    label: TEAM_ROLE_LABELS[role] || role,
                    value: role,
                  }))}
                />
                <div className="flex items-end">
                  <Button type="submit" variant="primary" disabled={Boolean(busyAction)} className="w-full">
                    {busyAction === 'add-member' ? 'Adding...' : 'Add Member'}
                  </Button>
                </div>
              </form>

              <DataTable
                headers={['User', 'Global Role', 'Team Role', 'Joined', 'Actions']}
                loading={detailLoading}
                emptyMessage="No members in this team yet."
                size="sm"
              >
                {teamDetail.members.map((member) => {
                  const currentRole = memberRoleDraft[member.id] || toRole(String(member.teamRole));
                  return (
                    <tr key={member.id} className="hover:bg-bgApp transition">
                      <td className="px-3 py-2">
                        <div className="font-medium text-textPrimary">{member.userEmail || `#${member.userId}`}</div>
                        <div className="text-xs text-textMuted">user id: {member.userId}</div>
                      </td>
                      <td className="px-3 py-2 text-textMuted">
                        {member.userRole
                          ? IDE_ROLE_LABELS[member.userRole as keyof typeof IDE_ROLE_LABELS] || member.userRole
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            value={currentRole}
                            onChange={(event) =>
                              setMemberRoleDraft((prev) => ({
                                ...prev,
                                [member.id]: toRole(String(event.target.value)),
                              }))
                            }
                            className="rounded-md border border-borderSubtle bg-bgSurface px-2 py-1 text-xs text-textPrimary"
                          >
                            {TEAM_ROLE_ORDER.map((role) => (
                              <option key={role} value={role}>
                                {TEAM_ROLE_LABELS[role] || role}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={Boolean(busyAction) || currentRole === TEAM_ROLE_ORDER[0]}
                            onClick={() => void handlePromoteDemoteMember(member.id, currentRole, -1)}
                          >
                            Demote
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={Boolean(busyAction) || currentRole === TEAM_ROLE_ORDER[TEAM_ROLE_ORDER.length - 1]}
                            onClick={() => void handlePromoteDemoteMember(member.id, currentRole, 1)}
                          >
                            Promote
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            disabled={Boolean(busyAction)}
                            onClick={() => void handleSetMemberRole(member.id, currentRole)}
                          >
                            {busyAction === `member-role:${member.id}` ? 'Saving...' : 'Set Role'}
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-textMuted">{formatDate(member.createdAt)}</td>
                      <td className="px-3 py-2">
                        <Button
                          variant="danger"
                          size="xs"
                          disabled={Boolean(busyAction)}
                          onClick={() => void handleRemoveMember(member.id, member.userEmail)}
                        >
                          {busyAction === `member-remove:${member.id}` ? 'Removing...' : 'Remove'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            </div>
          </DataCard>

          <DataCard title="Tenant Access" subtitle="Assign tenants to this team. Team members only see assigned tenants.">
            <div className="space-y-4">
              <form className="grid gap-3 md:grid-cols-4" onSubmit={handleAssignTenant}>
                <Select
                  label="Tenant"
                  value={tenantIdToAssign}
                  onChange={(event) => setTenantIdToAssign(String(event.target.value))}
                  className="md:col-span-3"
                >
                  <option value="">Select tenant</option>
                  {availableTenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.hostname}
                    </option>
                  ))}
                </Select>
                <div className="flex items-end">
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={Boolean(busyAction) || !tenantIdToAssign}
                  >
                    {busyAction === 'assign-tenant' ? 'Assigning...' : 'Assign Tenant'}
                  </Button>
                </div>
              </form>

              <DataTable
                headers={['Tenant', 'Status', 'Registration', 'Actions']}
                emptyMessage="No tenants assigned to this team."
                size="sm"
              >
                {assignedTenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-bgApp transition">
                    <td className="px-3 py-2 text-textPrimary">{tenant.hostname}</td>
                    <td className="px-3 py-2 text-textMuted">
                      {tenant.isSuspended ? 'Suspended' : 'Active'}
                    </td>
                    <td className="px-3 py-2 text-textMuted">
                      {tenant.allowRegistration ? 'Enabled' : 'Disabled'}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="danger"
                        size="xs"
                        disabled={Boolean(busyAction)}
                        onClick={() => void handleUnassignTenant(tenant.id, tenant.hostname)}
                      >
                        {busyAction === `unassign-tenant:${tenant.id}` ? 'Removing...' : 'Remove'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </DataCard>
        </>
      ) : null}
    </div>
  );
}
