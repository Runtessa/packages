import { fetchJson } from '@/lib/client/api';
import { TEAM_MEMBER_ROLES, type TeamMemberRole } from '@/lib/team-roles';
import { IDE_ROLE_LABELS } from '@/lib/rbac';

export const TEAM_ROLE_ORDER = TEAM_MEMBER_ROLES;
export type TeamRole = TeamMemberRole;
export const TEAM_ROLE_LABELS: Record<string, string> = {
  ...IDE_ROLE_LABELS,
};

export type TeamSummary = {
  id: number;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TeamMemberRow = {
  id: number;
  teamId: number;
  userId: number;
  teamRole: TeamRole | string;
  teamRoles: Array<TeamRole | string>;
  userEmail: string | null;
  userRole: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeamDetailPayload = {
  team: TeamSummary;
  members: TeamMemberRow[];
};

export type TeamUserOption = {
  id: number;
  email: string;
  role: string;
};

export type TeamTenantOption = {
  id: string;
  hostname: string;
  isSuspended: boolean;
  allowRegistration: boolean;
  assigned: boolean;
};

export const fetchTeams = async (
  token: string,
  options?: { page?: number; limit?: number; q?: string }
) => {
  const qs = new URLSearchParams({
    page: String(options?.page ?? 1),
    limit: String(options?.limit ?? 20),
  });
  if (options?.q?.trim()) qs.set('q', options.q.trim());
  return (await fetchJson(`/api/admin/teams?${qs.toString()}`, { token })) as {
    teams: TeamSummary[];
    total: number;
    page: number;
    limit: number;
    allowedTeamRoles: TeamRole[];
  };
};

export const createTeam = async (
  token: string,
  body: { name: string; key?: string; description?: string; isActive?: boolean }
) =>
  (await fetchJson('/api/admin/teams', {
    method: 'POST',
    token,
    body,
  })) as { team: TeamSummary };

export const fetchTeamDetail = async (token: string, teamId: number) =>
  (await fetchJson(`/api/admin/teams/${encodeURIComponent(String(teamId))}`, { token })) as TeamDetailPayload;

export const updateTeam = async (
  token: string,
  teamId: number,
  body: { name?: string; key?: string; description?: string | null; isActive?: boolean }
) =>
  (await fetchJson(`/api/admin/teams/${encodeURIComponent(String(teamId))}`, {
    method: 'PUT',
    token,
    body,
  })) as { team: TeamSummary };

export const deleteTeam = async (token: string, teamId: number) =>
  fetchJson(`/api/admin/teams/${encodeURIComponent(String(teamId))}`, {
    method: 'DELETE',
    token,
  });

export const addTeamMember = async (
  token: string,
  teamId: number,
  body: { userId: number; roles: Array<TeamRole | string> }
) =>
  (await fetchJson(`/api/admin/teams/${encodeURIComponent(String(teamId))}/members`, {
    method: 'POST',
    token,
    body,
  })) as { member: TeamMemberRow };

export const updateTeamMemberRole = async (
  token: string,
  teamId: number,
  memberId: number,
  body: { roles: Array<TeamRole | string> }
) =>
  (await fetchJson(
    `/api/admin/teams/${encodeURIComponent(String(teamId))}/members/${encodeURIComponent(String(memberId))}`,
    {
      method: 'PUT',
      token,
      body,
    }
  )) as { member: TeamMemberRow };

export const removeTeamMember = async (token: string, teamId: number, memberId: number) =>
  fetchJson(
    `/api/admin/teams/${encodeURIComponent(String(teamId))}/members/${encodeURIComponent(String(memberId))}`,
    {
      method: 'DELETE',
      token,
    }
  );

export const fetchTeamUsers = async (token: string) => {
  const data = await fetchJson('/api/users?page=1&limit=300', { token });
  const rows = Array.isArray(data?.users) ? data.users : [];
  return rows
    .map((entry: any) => ({
      id: Number(entry?.id),
      email: String(entry?.email || ''),
      role: String(entry?.role || ''),
    }))
    .filter((entry: TeamUserOption) => Number.isInteger(entry.id) && entry.id > 0 && Boolean(entry.email));
};

export const fetchTeamTenants = async (token: string, teamId: number) =>
  (await fetchJson(`/api/admin/teams/${encodeURIComponent(String(teamId))}/tenants`, {
    token,
  })) as {
    teamId: number;
    assignments: Array<{ id: number; teamId: number; tenantId: string; createdAt: string }>;
    tenants: TeamTenantOption[];
  };

export const assignTeamTenant = async (token: string, teamId: number, tenantId: string) =>
  fetchJson(`/api/admin/teams/${encodeURIComponent(String(teamId))}/tenants`, {
    method: 'POST',
    token,
    body: { tenantId },
  });

export const unassignTeamTenant = async (token: string, teamId: number, tenantId: string) =>
  fetchJson(
    `/api/admin/teams/${encodeURIComponent(String(teamId))}/tenants/${encodeURIComponent(tenantId)}`,
    {
      method: 'DELETE',
      token,
    }
  );
