export const IDE_PERMISSION_DOMAINS = [
  'ide.ui.read',
  'ide.ui.write',
  'ide.ui.publish',
  'ide.modules.read',
  'ide.modules.write',
  'ide.models.read',
  'ide.models.write',
  'ide.models.migrate',
  'ide.acl.read',
  'ide.acl.write',
  'ide.shared_ui.read',
  'ide.shared_ui.write',
  'ide.shared_modules.read',
  'ide.shared_modules.write',
  'ide.monitoring.read',
  'ide.monitoring.manage',
  'ide.containers.read',
  'ide.containers.manage',
  'ide.tenants.read',
  'ide.tenants.manage',
  'ide.users.read',
  'ide.users.manage',
  'ide.settings.manage',
  'ide.logs.read',
] as const;

export type IdePermission = (typeof IDE_PERMISSION_DOMAINS)[number];

export const IDE_ROLE_BLUEPRINT = [
  'admin',
  'platform_admin',
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

export type IdeRole = (typeof IDE_ROLE_BLUEPRINT)[number];

const ALL_PERMISSIONS = [...IDE_PERMISSION_DOMAINS];

const READ_PERMISSIONS: IdePermission[] = [
  'ide.ui.read',
  'ide.modules.read',
  'ide.models.read',
  'ide.acl.read',
  'ide.shared_ui.read',
  'ide.shared_modules.read',
  'ide.monitoring.read',
  'ide.containers.read',
  'ide.tenants.read',
  'ide.users.read',
  'ide.logs.read',
];

const ROLE_PERMISSIONS: Record<IdeRole, Array<IdePermission | '*'>> = {
  admin: ['*'],
  platform_admin: ['*'],
  tenant_admin: [
    'ide.tenants.read',
    'ide.tenants.manage',
    'ide.shared_ui.read',
    'ide.shared_ui.write',
    'ide.shared_modules.read',
    'ide.shared_modules.write',
    'ide.ui.read',
    'ide.ui.write',
    'ide.ui.publish',
    'ide.modules.read',
    'ide.modules.write',
    'ide.models.read',
    'ide.models.write',
    'ide.models.migrate',
    'ide.acl.read',
    'ide.acl.write',
  ],
  backend_developer: [
    'ide.tenants.read',
    'ide.shared_ui.read',
    'ide.shared_modules.read',
    'ide.ui.read',
    'ide.modules.read',
    'ide.modules.write',
    'ide.models.read',
    'ide.models.write',
    'ide.models.migrate',
    'ide.acl.read',
    'ide.acl.write',
  ],
  frontend_developer: [
    'ide.tenants.read',
    'ide.ui.read',
    'ide.ui.write',
    'ide.ui.publish',
    'ide.shared_ui.read',
    'ide.shared_ui.write',
    'ide.shared_modules.read',
    'ide.modules.read',
    'ide.models.read',
  ],
  model_developer: [
    'ide.tenants.read',
    'ide.shared_ui.read',
    'ide.shared_modules.read',
    'ide.ui.read',
    'ide.modules.read',
    'ide.models.read',
    'ide.models.write',
    'ide.models.migrate',
  ],
  integration_developer: [
    'ide.tenants.read',
    'ide.shared_ui.read',
    'ide.shared_modules.read',
    'ide.ui.read',
    'ide.modules.read',
    'ide.modules.write',
    'ide.models.read',
    'ide.acl.read',
    'ide.acl.write',
  ],
  qa_engineer: [...READ_PERMISSIONS],
  security_reviewer: [
    ...READ_PERMISSIONS,
    'ide.acl.write',
  ],
  ops_engineer: [
    'ide.tenants.read',
    'ide.monitoring.read',
    'ide.monitoring.manage',
    'ide.containers.read',
    'ide.containers.manage',
    'ide.logs.read',
  ],
  observer: [...READ_PERMISSIONS],
  user: [
    'ide.tenants.read',
    'ide.shared_ui.read',
    'ide.shared_modules.read',
    'ide.ui.read',
    'ide.modules.read',
    'ide.models.read',
  ],
};

export const IDE_ROLE_LABELS: Record<IdeRole, string> = {
  admin: 'Built-in Admin',
  platform_admin: 'Platform Admin',
  tenant_admin: 'Tenant Admin',
  backend_developer: 'Backend Developer',
  frontend_developer: 'Frontend Developer',
  model_developer: 'Model Developer',
  integration_developer: 'Integration Developer',
  qa_engineer: 'QA Engineer',
  security_reviewer: 'Security Reviewer',
  ops_engineer: 'Ops Engineer',
  observer: 'Observer',
  user: 'User',
};

export const IDE_ROLE_DESCRIPTIONS: Record<IdeRole, string> = {
  admin: 'Built-in root admin for bootstrap and break-glass access.',
  platform_admin:
    'Full access to shared backend/UI, tenants, users, monitoring, containers, and gateway.',
  tenant_admin:
    'Full access inside assigned tenant scope, including publish control for tenant modules and UI.',
  backend_developer:
    'CRUD backend modules and tenant ACL, with read access to UI and model artifacts.',
  frontend_developer:
    'CRUD tenant/shared UI packages, connect to real APIs via @app/datacontext.',
  model_developer: 'CRUD ORM models and migrations, with read access to backend/UI.',
  integration_developer:
    'Build backend integrations, adapters, webhooks, and related ACL surfaces.',
  qa_engineer:
    'Read all code, run preview checks, inspect logs/monitoring, and execute test flows.',
  security_reviewer:
    'Read all code and approve security/ACL-sensitive changes without feature authoring.',
  ops_engineer:
    'Operate monitoring and codex-gateway containers/services without app-code edits.',
  observer: 'Read-only role across all IDE resources.',
  user: 'Basic collaborator with limited read access.',
};

export const isKnownIdeRole = (value: string): value is IdeRole =>
  IDE_ROLE_BLUEPRINT.includes(value as IdeRole);

export const normalizeIdeRole = (value: unknown): IdeRole => {
  const role = String(value || '').trim().toLowerCase();
  if (isKnownIdeRole(role)) return role;
  return 'user';
};

export const getRolePermissions = (roleInput: unknown): IdePermission[] => {
  const role = normalizeIdeRole(roleInput);
  const raw = ROLE_PERMISSIONS[role] || [];
  if (raw.includes('*')) return ALL_PERMISSIONS;
  return raw.filter((perm): perm is IdePermission => perm !== '*');
};

export const hasIdePermission = (roleInput: unknown, permission: IdePermission): boolean => {
  const role = normalizeIdeRole(roleInput);
  const raw = ROLE_PERMISSIONS[role] || [];
  if (raw.includes('*')) return true;
  return raw.includes(permission);
};

export const listAssignableRoles = (actorRoleInput: unknown): IdeRole[] => {
  const actorRole = normalizeIdeRole(actorRoleInput);
  if (actorRole === 'admin') {
    return IDE_ROLE_BLUEPRINT.filter((role) => role !== 'admin');
  }
  if (actorRole === 'platform_admin') {
    return IDE_ROLE_BLUEPRINT.filter((role) => !['admin', 'platform_admin'].includes(role));
  }
  return [];
};

export const canAssignRole = (actorRoleInput: unknown, targetRoleInput: unknown): boolean => {
  const targetRole = normalizeIdeRole(targetRoleInput);
  return listAssignableRoles(actorRoleInput).includes(targetRole);
};
