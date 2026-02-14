import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage } from '@idp/shared';
import { GlobalUIPackageFile } from '@idp/shared';
import { Like, Not } from 'typeorm';
import { generateVersion } from '@/lib/version';
import { hasIdePermission, normalizeIdeRole } from '@/lib/rbac';
import {
  applySharedProjectTeamAccess,
  canEditSharedProject,
  canManageSharedProjectAccess,
  canPublishSharedProject,
  getActiveTeamId,
  getSharedProjectTeamAccess,
  normalizeTeamIdList,
} from '@/lib/shared-project-access';
import {
  ensureTailwindDependency,
  getTailwindPackageName,
  isTailwindPackageName,
  shouldBuildTailwind,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import { buildTailwindCssFromFiles, upsertGlobalTailwindPackage } from '@/lib/shared-tailwind';

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
  if (!trimmed) return 'src/index.jsx';
  const extMatch = trimmed.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${trimmed}.jsx`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext === 'js' || ext === 'jsx') return trimmed;
  return trimmed.replace(/\.[^.\/]+$/, '.jsx');
};

const normalizeFileExtension = (raw: unknown): string => {
  const allowed = new Set(['jsx', 'js', 'json', 'css']);
  if (!raw || typeof raw !== 'string') return 'jsx';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'jsx';
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

const serialize = (pkg: GlobalUIPackage, user: Awaited<ReturnType<typeof requireAdmin>>) => {
  const teamAccess = getSharedProjectTeamAccess(pkg);
  return {
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  entryPath: pkg.entryPath,
  code: pkg.code,
  codeBlob: pkg.codeBlob,
  dependencies: stripTailwindDependency(pkg.dependencies ?? [], getTailwindPackageName(pkg.name)),
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

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const user = await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const { page, limit, skip } = parsePagination(req.query.page, req.query.limit);
    const [packages, total] = await repo.findAndCount({
      where: { name: Not(Like('%__tw')) },
      order: { name: 'ASC', version: 'DESC' },
      skip,
      take: limit,
    });
    const canCreate =
      user.isAdmin || hasIdePermission(user.normalizedRole, 'ide.shared_ui.write');
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
        : 'src/index.jsx';
    const isTwPackage = isTailwindPackageName(normalizedName);
    const usesTailwind = shouldBuildTailwind(fileExtension) && !isTwPackage;
    const tailwindName = getTailwindPackageName(normalizedName);
    const depsWithTailwind = usesTailwind
      ? ensureTailwindDependency(normalizedDeps, tailwindName)
      : stripTailwindDependency(normalizedDeps, tailwindName);

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const fileRepo = CoreDataSource.getRepository(GlobalUIPackageFile);
    const existing = await repo.findOne({
      where: { name: normalizedName, version: normalizedVersion },
    });
    if (existing) {
      res.status(409).json({ error: 'Shared package already exists with this name/version' });
      return;
    }

    const pkg = repo.create({
      name: normalizedName,
      version: normalizedVersion,
      entryPath: normalizedEntry,
      code: normalizedCode,
      codeBlob: compiledCode,
      dependencies: depsWithTailwind,
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
    const role = normalizeIdeRole(user.normalizedRole || user.role);
    const allowEditorAssignments = user.isAdmin || role === 'tenant_admin';
    applySharedProjectTeamAccess(
      pkg,
      ownerTeamId,
      allowEditorAssignments ? requestedEditorTeamIds : []
    );
    await repo.save(pkg);

    const entryFile = fileRepo.create({
      project: pkg,
      path: normalizedEntry,
      fileExtension: normalizedEntry.split('.').pop() || 'jsx',
      content: normalizedCode,
    });
    await fileRepo.save(entryFile);
    if (usesTailwind) {
      const files = await fileRepo.find({
        where: { project: { id: pkg.id } },
        order: { path: 'ASC' },
      });
      const css = await buildTailwindCssFromFiles(files);
      await upsertGlobalTailwindPackage(tailwindName, normalizedVersion, css);
    }
    res.status(201).json({ package: serialize(pkg, user) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
