import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage } from '@idp/shared';
import { GlobalUIPackageFile } from '@idp/shared';
import redis from '@/lib/redis';
import { generateVersion } from '@/lib/version';
import {
  ensureTailwindDependency,
  getTailwindPackageName,
  isTailwindPackageName,
  shouldBuildTailwind,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import {
  buildTailwindCssFromFiles,
  removeGlobalTailwindPackage,
  upsertGlobalTailwindPackage,
} from '@/lib/shared-tailwind';
import {
  canEditSharedProject,
  canManageSharedProjectAccess,
  canPublishSharedProject,
  claimSharedProjectOwnershipIfNeeded,
  ensureSharedProjectEditable,
  getSharedProjectTeamAccess,
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

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const user = await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const pkg = await repo.findOne({ where: { id: req.query.id as string } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared package not found' });
      return;
    }
    res.status(200).json({ package: serialize(pkg, user) });
    return;
  }

  if (req.method === 'PUT') {
    const user = await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const fileRepo = CoreDataSource.getRepository(GlobalUIPackageFile);
    const pkg = await repo.findOne({ where: { id: req.query.id as string } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared package not found' });
      return;
    }
    const access = ensureSharedProjectEditable(user, pkg);
    const claimed = claimSharedProjectOwnershipIfNeeded(pkg, access);
    if (claimed) {
      await repo.save(pkg);
    }
    const previousName = pkg.name;
    const previousVersion = pkg.version;

    const nextName = req.body?.name ? normalizeName(req.body.name) : pkg.name;
    const nextVersion = req.body?.version ? normalizeVersion(req.body.version) : pkg.version;
    const nextEntry =
      req.body?.entryPath !== undefined && typeof req.body.entryPath === 'string'
        ? normalizeEntryPath(req.body.entryPath) || pkg.entryPath
        : pkg.entryPath;
    const nextSource =
      req.body?.code !== undefined ? normalizeSourceCode(req.body.code) : pkg.code;
    const nextCompiled =
      req.body?.codeBlob !== undefined
        ? normalizeCompiledCode(req.body.codeBlob)
        : pkg.codeBlob;
    const nextDepsRaw =
      req.body?.dependencies !== undefined
        ? normalizeDependencies(req.body.dependencies)
        : pkg.dependencies ?? [];
    const nextExt =
      req.body?.fileExtension !== undefined
        ? normalizeFileExtension(req.body.fileExtension)
        : pkg.fileExtension;

    if (nextName !== pkg.name || nextVersion !== pkg.version) {
      const duplicate = await repo.findOne({
        where: { name: nextName, version: nextVersion },
      });
      if (duplicate && duplicate.id !== pkg.id) {
        res.status(409).json({ error: 'Another shared package uses this name/version' });
        return;
      }
    }

    const usesTailwind =
      shouldBuildTailwind(nextExt) && !isTailwindPackageName(nextName);
    const nextTailwindName = getTailwindPackageName(nextName);
    const previousTailwindName = getTailwindPackageName(previousName);
    const depsSansTailwind = stripTailwindDependency(
      stripTailwindDependency(nextDepsRaw, previousTailwindName),
      nextTailwindName
    );
    const nextDeps = usesTailwind
      ? ensureTailwindDependency(depsSansTailwind, nextTailwindName)
      : depsSansTailwind;

    pkg.name = nextName;
    pkg.version = nextVersion;
    pkg.entryPath = nextEntry;
    pkg.code = nextSource;
    pkg.codeBlob = nextCompiled;
    pkg.dependencies = nextDeps;
    pkg.fileExtension = nextExt;
    pkg.draftVersion = generateVersion();
    await repo.save(pkg);

    if (!usesTailwind) {
      await removeGlobalTailwindPackage(previousTailwindName, previousVersion);
    } else {
      if (previousTailwindName !== nextTailwindName || previousVersion !== nextVersion) {
        await removeGlobalTailwindPackage(previousTailwindName, previousVersion);
      }
      const files = await fileRepo.find({
        where: { project: { id: pkg.id } },
        order: { path: 'ASC' },
      });
      const css = await buildTailwindCssFromFiles(files);
      await upsertGlobalTailwindPackage(nextTailwindName, nextVersion, css);
    }

    res.status(200).json({ package: serialize(pkg, user) });
    return;
  }

  if (req.method === 'DELETE') {
    const user = await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const pkg = await repo.findOne({ where: { id: req.query.id as string } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared package not found' });
      return;
    }
    ensureSharedProjectEditable(user, pkg);
    const encoded = encodeURIComponent(pkg.name);
    await redis.del(`registry:global:${encoded}:latest`, `registry:global:${encoded}:${pkg.version}`);
    await removeGlobalTailwindPackage(getTailwindPackageName(pkg.name), pkg.version);
    await repo.remove(pkg);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
