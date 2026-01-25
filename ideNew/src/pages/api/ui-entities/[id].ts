import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@/lib/entities/UIEntities';
import { UIPackageRevision } from '@/lib/entities/UIPackageRevision';
import { resolveTenant } from '@/lib/tenancy';

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
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('code is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeCompiledCode = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('codeBlob (compiled output) is required');
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

const serialize = (pkg: UIPackage) => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  code: pkg.code,
  codeBlob: pkg.codeBlob,
  dependencies: pkg.dependencies ?? [],
  fileExtension: pkg.fileExtension,
  createdAt: pkg.createdAt,
  updatedAt: pkg.updatedAt,
});

const createRevision = async (
  pkg: UIPackage,
  tenant: { id: string },
  userId: number,
  action: string
) => {
  const revRepo = CoreDataSource.getRepository(UIPackageRevision);
  const last = await revRepo.findOne({
    where: { uiPackage: { id: pkg.id } },
    order: { revision: 'DESC' },
  });
  const revision = revRepo.create({
    uiPackage: pkg,
    tenant: tenant as any,
    revision: (last?.revision ?? 0) + 1,
    name: pkg.name,
    version: pkg.version,
    code: pkg.code,
    codeBlob: pkg.codeBlob,
    dependencies: pkg.dependencies ?? [],
    fileExtension: pkg.fileExtension,
    action,
    createdBy: null,
  });
  await revRepo.save(revision);
  return revision;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const user = await requireUser(req);
  const tenant = await resolveTenant(req);
  const repo = CoreDataSource.getRepository(UIPackage);

  if (req.method === 'GET') {
    const pkg = await repo.findOne({
      where: { id: req.query.id as string, tenant: { id: tenant.id } },
    });
    if (!pkg) {
      res.status(404).json({ error: 'UI entity not found' });
      return;
    }
    res.status(200).json(serialize(pkg));
    return;
  }

  if (req.method === 'PUT') {
    const pkg = await repo.findOne({
      where: { id: req.query.id as string, tenant: { id: tenant.id } },
    });
    if (!pkg) {
      res.status(404).json({ error: 'UI entity not found' });
      return;
    }

    const nextName = req.body?.name ? normalizeName(req.body.name) : pkg.name;
    const nextVersion = req.body?.version ? normalizeVersion(req.body.version) : pkg.version;
    const nextSource =
      req.body?.code !== undefined ? normalizeSourceCode(req.body.code) : pkg.code;
    const nextCompiled =
      req.body?.codeBlob !== undefined ? normalizeCompiledCode(req.body.codeBlob) : pkg.codeBlob;
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
        where: { tenant: { id: tenant.id }, name: nextName, version: nextVersion },
      });
      if (duplicate && duplicate.id !== pkg.id) {
        res.status(409).json({ error: 'Another UI entity already uses this name/version' });
        return;
      }
    }

    await createRevision(pkg, tenant, user.id, 'update');

    pkg.name = nextName;
    pkg.version = nextVersion;
    pkg.code = nextSource;
    pkg.codeBlob = nextCompiled;
    pkg.dependencies = nextDeps;
    pkg.fileExtension = nextExt;
    await repo.save(pkg);

    res.status(200).json(serialize(pkg));
    return;
  }

  if (req.method === 'DELETE') {
    const pkg = await repo.findOne({
      where: { id: req.query.id as string, tenant: { id: tenant.id } },
    });
    if (!pkg) {
      res.status(404).json({ error: 'UI entity not found' });
      return;
    }
    await createRevision(pkg, tenant, user.id, 'delete');
    await repo.remove(pkg);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
