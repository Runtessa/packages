import { IDE_ROLE_LABELS } from '@/lib/rbac';

export const TEAM_MEMBER_ROLES = [
  'tenant_admin',
  'backend_developer',
  'frontend_developer',
  'model_developer',
  'integration_developer',
  'qa_engineer',
  'security_reviewer',
  'ops_engineer',
  'observer',
  'user',
] as const;

export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export const normalizeTeamMemberRole = (value: unknown): TeamMemberRole => {
  const role = String(value || '').trim().toLowerCase();
  if (TEAM_MEMBER_ROLES.includes(role as TeamMemberRole)) {
    return role as TeamMemberRole;
  }
  return 'observer';
};

export const TEAM_MEMBER_ROLE_OPTIONS = TEAM_MEMBER_ROLES.map((role) => ({
  value: role,
  label: IDE_ROLE_LABELS[role] || role,
}));
