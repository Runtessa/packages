import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalModuleEndpoint, GlobalModulePackage, HttpMethod } from '@idp/shared';

const normalizeRoutePath = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('routePath is required');
    (err as any).statusCode = 400;
    throw err;
  }
  const trimmed = raw.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const normalizeMethod = (raw: unknown) => {
  const value = String(raw || '').toUpperCase();
  if (!Object.values(HttpMethod).includes(value as HttpMethod)) {
    const err = new Error('Invalid HTTP method');
    (err as any).statusCode = 400;
    throw err;
  }
  return value as HttpMethod;
};

const normalizeAllowAnonymous = (raw: unknown) => {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  const value = String(raw).trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
};

const serialize = (endpoint: GlobalModuleEndpoint) => ({
  id: endpoint.id,
  routePath: endpoint.routePath,
  method: endpoint.method,
  allowAnonymous: Boolean(endpoint.allowAnonymous),
  packageId: endpoint.package?.id,
  packageName: endpoint.package?.name,
  packageVersion: endpoint.package?.version,
  createdAt: endpoint.createdAt,
  updatedAt: endpoint.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireAdmin(req);
  await ensureCoreSchema();

  const repo = CoreDataSource.getRepository(GlobalModuleEndpoint);
  const pkgRepo = CoreDataSource.getRepository(GlobalModulePackage);
  const endpoint = await repo.findOne({ where: { id: req.query.id as string }, relations: ['package'] });
  if (!endpoint) {
    res.status(404).json({ error: 'Shared backend route not found' });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ endpoint: serialize(endpoint) });
    return;
  }

  if (req.method === 'PUT') {
    const routePath =
      req.body?.routePath !== undefined ? normalizeRoutePath(req.body.routePath) : endpoint.routePath;
    const method =
      req.body?.method !== undefined ? normalizeMethod(req.body.method) : endpoint.method;
    const allowAnonymous = normalizeAllowAnonymous(req.body?.allowAnonymous);
    let pkg = endpoint.package;
    if (req.body?.packageId !== undefined) {
      const packageId = String(req.body?.packageId || '').trim();
      if (!packageId) {
        const err = new Error('packageId is required');
        (err as any).statusCode = 400;
        throw err;
      }
      const next = await pkgRepo.findOne({ where: { id: packageId } });
      if (!next) {
        res.status(404).json({ error: 'Shared backend project not found' });
        return;
      }
      pkg = next;
    }

    const existing = await repo.findOne({ where: { routePath, method } });
    if (existing && existing.id !== endpoint.id) {
      res.status(409).json({ error: 'Route already mapped' });
      return;
    }

    endpoint.routePath = routePath;
    endpoint.method = method;
    if (allowAnonymous !== undefined) {
      endpoint.allowAnonymous = allowAnonymous;
    }
    endpoint.package = pkg;
    await repo.save(endpoint);
    const saved = await repo.findOne({ where: { id: endpoint.id }, relations: ['package'] });
    res.status(200).json({ endpoint: saved ? serialize(saved) : serialize(endpoint) });
    return;
  }

  if (req.method === 'DELETE') {
    await repo.remove(endpoint);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
