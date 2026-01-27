import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage } from '@/lib/entities/GlobalUIPackage';

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

const normalizeFileExtension = (raw: unknown): string => {
  const allowed = new Set(['tsx', 'jsx', 'ts', 'js', 'json', 'css']);
  if (!raw || typeof raw !== 'string') return 'tsx';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'tsx';
};

const serialize = (pkg: GlobalUIPackage) => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  entryPath: pkg.entryPath,
  code: pkg.code,
  codeBlob: pkg.codeBlob,
  dependencies: pkg.dependencies ?? [],
  fileExtension: pkg.fileExtension,
  createdAt: pkg.createdAt,
  updatedAt: pkg.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const pkg = await repo.findOne({ where: { id: req.query.id as string } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared package not found' });
      return;
    }

    res.status(200).json({ package: serialize(pkg) });
    return;
  }

  if (req.method === 'PUT') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const pkg = await repo.findOne({ where: { id: req.query.id as string } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared package not found' });
      return;
    }

    const nextName = req.body?.name ? normalizeName(req.body.name) : pkg.name;
    const nextVersion = req.body?.version ? normalizeVersion(req.body.version) : pkg.version;
    const nextEntry =
      req.body?.entryPath !== undefined && typeof req.body.entryPath === 'string'
        ? req.body.entryPath.trim() || pkg.entryPath
        : pkg.entryPath;
    const nextSource =
      req.body?.code !== undefined ? normalizeSourceCode(req.body.code) : pkg.code;
    const nextCompiled =
      req.body?.codeBlob !== undefined
        ? normalizeCompiledCode(req.body.codeBlob)
        : pkg.codeBlob;
    const nextDeps =
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

    pkg.name = nextName;
    pkg.version = nextVersion;
    pkg.entryPath = nextEntry;
    pkg.code = nextSource;
    pkg.codeBlob = nextCompiled;
    pkg.dependencies = nextDeps;
    pkg.fileExtension = nextExt;
    await repo.save(pkg);

    res.status(200).json({ package: serialize(pkg) });
    return;
  }

  if (req.method === 'DELETE') {
    await requireAdmin(req);
    await ensureCoreSchema();

    const repo = CoreDataSource.getRepository(GlobalUIPackage);
    const pkg = await repo.findOne({ where: { id: req.query.id as string } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared package not found' });
      return;
    }
    await repo.remove(pkg);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
