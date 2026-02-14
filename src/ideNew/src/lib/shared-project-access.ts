import { GlobalModulePackage, GlobalUIPackage } from '@idp/shared';
import { type IdePermission } from './rbac';

type SharedProject = Pick<GlobalUIPackage, 'ownerTeamId' | 'editorTeamIds'> &
  Pick<GlobalModulePackage, 'ownerTeamId' | 'editorTeamIds'>;

type SharedAccessUser = {
  isAdmin?: boolean;
  role?: string;
  normalizedRole?: string;
  activeTeamId?: number | null;
  permissions?: IdePermission[];
};

const forbidden = (message: string) => {
  const err = new Error(message);
  (err as any).statusCode = 403;
  return err;
};

const toPositiveInt = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

export const normalizeTeamIdList = (raw: unknown): number[] => {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => toPositiveInt(value))
        .filter((value): value is number => Number.isInteger(value))
    )
  ).sort((a, b) => a - b);
};

export const getActiveTeamId = (user: SharedAccessUser): number | null =>
  toPositiveInt(user?.activeTeamId);

export const getSharedProjectTeamAccess = (project: SharedProject) => {
  const ownerTeamId = toPositiveInt(project?.ownerTeamId ?? null);
  const editorTeamIds = normalizeTeamIdList(project?.editorTeamIds ?? []);
  return {
    ownerTeamId,
    editorTeamIds: ownerTeamId
      ? editorTeamIds.filter((teamId) => teamId !== ownerTeamId)
      : editorTeamIds,
  };
};

export const applySharedProjectTeamAccess = (
  project: SharedProject,
  nextOwnerTeamId: number | null,
  nextEditorTeamIds: number[]
) => {
  const ownerTeamId = toPositiveInt(nextOwnerTeamId);
  const editorTeamIds = normalizeTeamIdList(nextEditorTeamIds).filter(
    (teamId) => !ownerTeamId || teamId !== ownerTeamId
  );
  project.ownerTeamId = ownerTeamId;
  project.editorTeamIds = editorTeamIds;
};

type AccessResult = {
  allowed: boolean;
  shouldClaimOwner: boolean;
  activeTeamId: number | null;
};

const resolveEditorAccess = (user: SharedAccessUser, project: SharedProject): AccessResult => {
  if (user?.isAdmin) {
    return { allowed: true, shouldClaimOwner: false, activeTeamId: null };
  }
  const activeTeamId = getActiveTeamId(user);
  if (!activeTeamId) {
    return { allowed: false, shouldClaimOwner: false, activeTeamId: null };
  }
  const { ownerTeamId, editorTeamIds } = getSharedProjectTeamAccess(project);
  if (!ownerTeamId) {
    return { allowed: true, shouldClaimOwner: true, activeTeamId };
  }
  if (ownerTeamId === activeTeamId || editorTeamIds.includes(activeTeamId)) {
    return { allowed: true, shouldClaimOwner: false, activeTeamId };
  }
  return { allowed: false, shouldClaimOwner: false, activeTeamId };
};

const resolvePublishAccess = (user: SharedAccessUser, project: SharedProject): AccessResult => {
  if (user?.isAdmin) {
    return { allowed: true, shouldClaimOwner: false, activeTeamId: null };
  }
  const activeTeamId = getActiveTeamId(user);
  if (!activeTeamId) {
    return { allowed: false, shouldClaimOwner: false, activeTeamId: null };
  }
  const { ownerTeamId } = getSharedProjectTeamAccess(project);
  if (!ownerTeamId) {
    return { allowed: true, shouldClaimOwner: true, activeTeamId };
  }
  if (ownerTeamId === activeTeamId) {
    return { allowed: true, shouldClaimOwner: false, activeTeamId };
  }
  return { allowed: false, shouldClaimOwner: false, activeTeamId };
};

const resolveAccessAdminRights = (user: SharedAccessUser, project: SharedProject): AccessResult => {
  if (user?.isAdmin) {
    return { allowed: true, shouldClaimOwner: false, activeTeamId: null };
  }
  const canManage = Array.isArray(user?.permissions) && user.permissions.includes('ide.tenants.manage');
  if (!canManage) {
    return { allowed: false, shouldClaimOwner: false, activeTeamId: null };
  }
  const activeTeamId = getActiveTeamId(user);
  if (!activeTeamId) {
    return { allowed: false, shouldClaimOwner: false, activeTeamId: null };
  }
  const { ownerTeamId } = getSharedProjectTeamAccess(project);
  if (!ownerTeamId) {
    return { allowed: true, shouldClaimOwner: true, activeTeamId };
  }
  if (ownerTeamId === activeTeamId) {
    return { allowed: true, shouldClaimOwner: false, activeTeamId };
  }
  return { allowed: false, shouldClaimOwner: false, activeTeamId };
};

export const canEditSharedProject = (user: SharedAccessUser, project: SharedProject) =>
  resolveEditorAccess(user, project).allowed;

export const canPublishSharedProject = (user: SharedAccessUser, project: SharedProject) =>
  resolvePublishAccess(user, project).allowed;

export const canManageSharedProjectAccess = (user: SharedAccessUser, project: SharedProject) =>
  resolveAccessAdminRights(user, project).allowed;

export const ensureSharedProjectEditable = (user: SharedAccessUser, project: SharedProject) => {
  const access = resolveEditorAccess(user, project);
  if (!access.allowed) {
    throw forbidden('Forbidden: shared project edit requires owner or granted team access');
  }
  return access;
};

export const ensureSharedProjectPublishable = (user: SharedAccessUser, project: SharedProject) => {
  const access = resolvePublishAccess(user, project);
  if (!access.allowed) {
    throw forbidden('Forbidden: only owner team can publish shared project');
  }
  return access;
};

export const ensureSharedProjectAccessManaged = (
  user: SharedAccessUser,
  project: SharedProject
) => {
  const access = resolveAccessAdminRights(user, project);
  if (!access.allowed) {
    throw forbidden('Forbidden: only owner team tenant_admin can manage shared project access');
  }
  return access;
};

export const claimSharedProjectOwnershipIfNeeded = (
  project: SharedProject,
  access: AccessResult
) => {
  if (!access.shouldClaimOwner || !access.activeTeamId) return false;
  applySharedProjectTeamAccess(
    project,
    access.activeTeamId,
    normalizeTeamIdList(project.editorTeamIds ?? []).filter(
      (teamId) => teamId !== access.activeTeamId
    )
  );
  return true;
};
