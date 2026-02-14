import { IDE_ROLE_LABELS } from '@/lib/rbac';

export const TEAM_MEMBER_ROLES = [
  'tenant_admin',
  'model_developer',
  'backend_developer',
  'frontend_developer',
  'integration_developer',
  'qa_engineer',
  'security_reviewer',
  'ops_engineer',
  'observer',
  'user',
] as const;

export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

const TEAM_MEMBER_ROLE_RANK: Record<TeamMemberRole, number> = TEAM_MEMBER_ROLES.reduce(
  (acc, role, index) => {
    acc[role] = index;
    return acc;
  },
  {} as Record<TeamMemberRole, number>
);

// Optional explicit dependencies for future extension.
const ROLE_DEPENDENCIES: Partial<Record<TeamMemberRole, TeamMemberRole[]>> = {};

export const normalizeTeamMemberRole = (value: unknown): TeamMemberRole => {
  const role = String(value || '').trim().toLowerCase();
  if (TEAM_MEMBER_ROLES.includes(role as TeamMemberRole)) {
    return role as TeamMemberRole;
  }
  return 'observer';
};

export const normalizeTeamMemberRoles = (
  value: unknown,
  fallbackRole: TeamMemberRole = 'observer'
): TeamMemberRole[] => {
  const rawItems = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const normalized = Array.from(
    new Set(
      rawItems.map((item) => normalizeTeamMemberRole(item)).filter((role) => Boolean(role))
    )
  );
  if (!normalized.length) return [fallbackRole];
  // Tenant admin implicitly carries every team capability.
  if (normalized.includes('tenant_admin')) {
    return [...TEAM_MEMBER_ROLES];
  }
  return normalized.sort((a, b) => TEAM_MEMBER_ROLE_RANK[a] - TEAM_MEMBER_ROLE_RANK[b]);
};

export const getMissingRoleDependencies = (rolesInput: unknown): TeamMemberRole[] => {
  const roles = normalizeTeamMemberRoles(rolesInput);
  const selected = new Set(roles);
  const missing = new Set<TeamMemberRole>();
  for (const role of roles) {
    const dependencies = ROLE_DEPENDENCIES[role] || [];
    for (const dependency of dependencies) {
      if (!selected.has(dependency)) {
        missing.add(dependency);
      }
    }
  }
  // Custom business rule:
  // if user has model_developer and frontend_developer together,
  // backend_developer is required.
  if (
    selected.has('model_developer') &&
    selected.has('frontend_developer') &&
    !selected.has('backend_developer')
  ) {
    missing.add('backend_developer');
  }
  return Array.from(missing).sort((a, b) => TEAM_MEMBER_ROLE_RANK[a] - TEAM_MEMBER_ROLE_RANK[b]);
};

export const assertTeamRoleSequence = (rolesInput: unknown) => {
  const roles = normalizeTeamMemberRoles(rolesInput);
  const missing = getMissingRoleDependencies(roles);
  if (!missing.length) {
    return roles;
  }
  const missingLabels = missing.map((role) => IDE_ROLE_LABELS[role] || role).join(', ');
  const err = new Error(
    `Invalid team role sequence. Missing prerequisite role(s): ${missingLabels}`
  );
  (err as any).statusCode = 400;
  throw err;
};

export const pickPrimaryTeamMemberRole = (rolesInput: unknown): TeamMemberRole =>
  normalizeTeamMemberRoles(rolesInput)[0] || 'observer';

export const TEAM_MEMBER_ROLE_OPTIONS = TEAM_MEMBER_ROLES.map((role) => ({
  value: role,
  label: IDE_ROLE_LABELS[role] || role,
}));

export const TEAM_MEMBER_ROLE_DEPENDENCIES = ROLE_DEPENDENCIES;
