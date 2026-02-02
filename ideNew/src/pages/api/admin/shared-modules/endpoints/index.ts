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
  if (raw === undefined) return false;
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

  if (req.method === 'GET') {
    const endpoints = await repo.find({
      relations: ['package'],
      order: { routePath: 'ASC' },
    });
    res.status(200).json({ endpoints: endpoints.map(serialize) });
    return;
  }

  if (req.method === 'POST') {
    const routePath = normalizeRoutePath(req.body?.routePath);
    const method = normalizeMethod(req.body?.method);
    const allowAnonymous = normalizeAllowAnonymous(req.body?.allowAnonymous);
    const packageId = String(req.body?.packageId || '').trim();
    if (!packageId) {
      const err = new Error('packageId is required');
      (err as any).statusCode = 400;
      throw err;
    }
    const pkg = await pkgRepo.findOne({ where: { id: packageId } });
    if (!pkg) {
      res.status(404).json({ error: 'Shared backend project not found' });
      return;
    }
    const existing = await repo.findOne({ where: { routePath, method } });
    if (existing) {
      res.status(409).json({ error: 'Route already mapped' });
      return;
    }
    const endpoint = repo.create({ routePath, method, package: pkg, allowAnonymous });
    await repo.save(endpoint);
    const saved = await repo.findOne({ where: { id: endpoint.id }, relations: ['package'] });
    res.status(201).json({ endpoint: saved ? serialize(saved) : serialize(endpoint) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
