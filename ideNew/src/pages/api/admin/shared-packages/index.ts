import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage } from '@idp/shared';
import { GlobalUIPackageFile } from '@idp/shared';
import { generateVersion } from '@/lib/version';
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

const serialize = (pkg: GlobalUIPackage) => ({
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
  createdAt: pkg.createdAt,
  updatedAt: pkg.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const packages = await repo.find({ order: { name: 'ASC', version: 'DESC' } });
    res
      .status(200)
      .json({ packages: packages.filter((pkg) => !isTailwindPackageName(pkg.name)).map(serialize) });
    return;
  }

  if (req.method === 'POST') {
    await requireAdmin(req);
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
    });
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
    res.status(201).json({ package: serialize(pkg) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
