import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalModulePackage } from '@idp/shared';
import { GlobalModulePackageFile } from '@idp/shared';
import { generateVersion } from '@/lib/version';
import { type IdePermission } from '@/lib/rbac';
import {
  applySharedProjectTeamAccess,
  canEditSharedProject,
  canManageSharedProjectAccess,
  canPublishSharedProject,
  getActiveTeamId,
  getSharedProjectTeamAccess,
  normalizeTeamIdList,
} from '@/lib/shared-project-access';

const normalizeName = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('name is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const normalizeVersion = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('version is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const normalizeSourceCode = (raw: unknown): string => {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    const err = new Error('code must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeCompiledCode = (raw: unknown): string => {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    const err = new Error('codeBlob must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeDependencies = (raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    const err = new Error('dependencies must be an array');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.map((item) => String(item));
};

const normalizeEntryPath = (raw: string) => {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) return 'src/index.js';
  const extMatch = trimmed.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${trimmed}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return trimmed.replace(/\.[^.\/]+$/, '.js');
  }
  return trimmed;
};

const normalizeFileExtension = (raw: unknown): string => {
  const allowed = new Set(['js', 'json']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'js';
};

const normalizeOwnerTeamId = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    const err = new Error('ownerTeamId must be a positive integer');
    (err as any).statusCode = 400;
    throw err;
  }
  return value;
};

const serialize = (pkg: GlobalModulePackage, user: Awaited<ReturnType<typeof requireAdmin>>) => {
  const teamAccess = getSharedProjectTeamAccess(pkg);
  return {
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  entryPath: pkg.entryPath,
  code: pkg.code,
  codeBlob: pkg.codeBlob,
  dependencies: pkg.dependencies ?? [],
  fileExtension: pkg.fileExtension,
  draftVersion: pkg.draftVersion,
  publishedVersion: pkg.publishedVersion ?? undefined,
  publishedAt: pkg.publishedAt ?? undefined,
  ownerTeamId: teamAccess.ownerTeamId ?? undefined,
  editorTeamIds: teamAccess.editorTeamIds,
  canEdit: canEditSharedProject(user, pkg),
  canPublish: canPublishSharedProject(user, pkg),
  canManageAccess: canManageSharedProjectAccess(user, pkg),
  createdAt: pkg.createdAt,
  updatedAt: pkg.updatedAt,
};
};

const parsePagination = (rawPage: unknown, rawLimit: unknown) => {
  const pageValue = Array.isArray(rawPage) ? rawPage[0] : rawPage;
  const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit;
  const pageNum = Number(pageValue ?? 1);
  const limitNum = Number(limitValue ?? 20);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? Math.floor(pageNum) : 1;
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(100, Math.floor(limitNum)) : 20;
  return { page, limit, skip: (page - 1) * limit };
};

const hasPermission = (user: Awaited<ReturnType<typeof requireAdmin>>, permission: IdePermission) =>
  user.isAdmin ||
  (Array.isArray(user.permissions) && user.permissions.includes(permission));

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const user = await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalModulePackage);
    const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
    const [packages, total] = await repo.findAndCount({
      order: { name: 'ASC', version: 'DESC' },
      skip,
      take: limit,
    });
    const canCreate = hasPermission(user, 'ide.shared_modules.write');
    res.status(200).json({
      packages: packages.map((pkg) => serialize(pkg, user)),
      page,
      limit,
      total,
      canCreate,
    });
    return;
  }

  if (req.method === 'POST') {
    const user = await requireAdmin(req);
    await ensureCoreSchema();

    const { name, version, codeBlob, dependencies, entryPath } = req.body ?? {};
    const normalizedName = normalizeName(name);
    const normalizedVersion = normalizeVersion(version);
    const normalizedCode = normalizeSourceCode(req.body?.code ?? codeBlob);
    const compiledCode = normalizeCompiledCode(
      req.body?.codeBlob ?? codeBlob ?? normalizedCode
    );
    const normalizedDeps = normalizeDependencies(dependencies);
    const fileExtension = normalizeFileExtension(req.body?.fileExtension);
    const requestedOwnerTeamId = normalizeOwnerTeamId(req.body?.ownerTeamId);
    const requestedEditorTeamIds = normalizeTeamIdList(req.body?.editorTeamIds);
    const normalizedEntry =
      typeof entryPath === 'string' && entryPath.trim()
        ? normalizeEntryPath(entryPath)
        : 'src/index.js';

    const repo = CoreDataSource.getRepository(GlobalModulePackage);
    const fileRepo = CoreDataSource.getRepository(GlobalModulePackageFile);
    const existing = await repo.findOne({
      where: { name: normalizedName, version: normalizedVersion },
    });
    if (existing) {
      res.status(409).json({ error: 'Shared backend project already exists with this name/version' });
      return;
    }

    const pkg = repo.create({
      name: normalizedName,
      version: normalizedVersion,
      entryPath: normalizedEntry,
      code: normalizedCode,
      codeBlob: compiledCode,
      dependencies: normalizedDeps,
      fileExtension,
      draftVersion: generateVersion(),
      ownerTeamId: null,
      editorTeamIds: [],
    });
    const activeTeamId = getActiveTeamId(user);
    const ownerTeamId = requestedOwnerTeamId ?? activeTeamId;
    if (
      !user.isAdmin &&
      requestedOwnerTeamId &&
      requestedOwnerTeamId !== activeTeamId
    ) {
      const err = new Error('Forbidden: non-admin users can only set ownerTeamId to active team');
      (err as any).statusCode = 403;
      throw err;
    }
    if (!ownerTeamId && !user.isAdmin) {
      const err = new Error('ownerTeamId is required when active team is not set');
      (err as any).statusCode = 400;
      throw err;
    }
    const allowEditorAssignments = hasPermission(user, 'ide.tenants.manage');
    applySharedProjectTeamAccess(
      pkg,
      ownerTeamId,
      allowEditorAssignments ? requestedEditorTeamIds : []
    );
    await repo.save(pkg);

    const entryFile = fileRepo.create({
      project: pkg,
      path: normalizedEntry,
      fileExtension: normalizedEntry.split('.').pop() || fileExtension,
      content: normalizedCode,
    });
    await fileRepo.save(entryFile);

    res.status(201).json({ package: serialize(pkg, user) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
