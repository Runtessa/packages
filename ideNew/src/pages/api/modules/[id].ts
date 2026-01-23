import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { HttpMethod, ModuleEntity } from '@/lib/entities/Module';
import { resolveTenant } from '@/lib/tenancy';

const normalizeMethod = (raw: unknown): HttpMethod => {
  if (typeof raw !== 'string') {
    const err = new Error('method is required');
    (err as any).statusCode = 400;
    throw err;
  }
  const upper = raw.toUpperCase();
  if (!Object.values(HttpMethod).includes(upper as HttpMethod)) {
    const err = new Error('Invalid HTTP method');
    (err as any).statusCode = 400;
    throw err;
  }
  return upper as HttpMethod;
};

const normalizeRoute = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('routePath is required');
    (err as any).statusCode = 400;
    throw err;
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const normalizeCode = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('code is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeFileExtension = (raw: unknown): string => {
  const allowed = new Set(['ts', 'js', 'jsx', 'tsx']);
  if (!raw || typeof raw !== 'string') return 'ts';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'ts';
};

const serialize = (mod: ModuleEntity) => ({
  id: mod.id,
  routePath: mod.routePath,
  method: mod.method,
  code: mod.code,
  fileExtension: mod.fileExtension,
  createdAt: mod.createdAt,
  updatedAt: mod.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireUser(req);
  const tenant = await resolveTenant(req);
  const repo = CoreDataSource.getRepository(ModuleEntity);

  if (req.method === 'GET') {
    const mod = await repo.findOne({
      where: { id: req.query.id as string, tenant: { id: tenant.id } },
    });
    if (!mod) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }
    res.status(200).json(serialize(mod));
    return;
  }

  if (req.method === 'PUT') {
    const mod = await repo.findOne({
      where: { id: req.query.id as string, tenant: { id: tenant.id } },
    });
    if (!mod) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    const nextRoute = req.body?.routePath ? normalizeRoute(req.body.routePath) : mod.routePath;
    const nextMethod = req.body?.method ? normalizeMethod(req.body.method) : mod.method;
    const nextCode = req.body?.code !== undefined ? normalizeCode(req.body.code) : mod.code;
    const nextExt =
      req.body?.fileExtension !== undefined
        ? normalizeFileExtension(req.body.fileExtension)
        : mod.fileExtension;

    if (nextRoute !== mod.routePath || nextMethod !== mod.method) {
      const duplicate = await repo.findOne({
        where: { tenant: { id: tenant.id }, routePath: nextRoute, method: nextMethod },
      });
      if (duplicate && duplicate.id !== mod.id) {
        res.status(409).json({ error: 'Another module already uses this route/method' });
        return;
      }
    }

    mod.routePath = nextRoute;
    mod.method = nextMethod;
    mod.code = nextCode;
    mod.fileExtension = nextExt;
    await repo.save(mod);

    res.status(200).json(serialize(mod));
    return;
  }

  if (req.method === 'DELETE') {
    const mod = await repo.findOne({
      where: { id: req.query.id as string, tenant: { id: tenant.id } },
    });
    if (!mod) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }
    await repo.remove(mod);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
