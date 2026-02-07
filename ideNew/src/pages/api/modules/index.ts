import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { HttpMethod, ModuleEntity, Tenant } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import { generateVersion } from '@/lib/version';

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
  const allowed = new Set(['js']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'js';
};

const ensureAclEndpoint = async (tenant: Tenant, routePath: string) => {
  const endpoints = (tenant.aclEndpoints ?? {}) as Record<
    string,
    { read?: string[]; write?: string[]; edit?: string[]; delete?: string[]; allowAnonymous?: boolean }
  >;
  if (endpoints[routePath]) return;
  endpoints[routePath] = {
    read: [],
    write: [],
    edit: [],
    delete: [],
    allowAnonymous: false,
  };
  tenant.aclEndpoints = endpoints as Tenant['aclEndpoints'];
  const tenantRepo = CoreDataSource.getRepository(Tenant);
  await tenantRepo.save(tenant);
};

const serialize = (mod: ModuleEntity) => ({
  id: mod.id,
  routePath: mod.routePath,
  method: mod.method,
  code: mod.code,
  fileExtension: mod.fileExtension,
  draftVersion: mod.draftVersion,
  publishedVersion: mod.publishedVersion ?? undefined,
  publishedAt: mod.publishedAt ?? undefined,
  createdAt: mod.createdAt,
  updatedAt: mod.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireUser(req);
    const tenant = await resolveTenant(req);
    const repo = CoreDataSource.getRepository(ModuleEntity);
    const modules = await repo.find({
      where: { tenant: { id: tenant.id } },
      order: { routePath: 'ASC', method: 'ASC' },
    });
    res.status(200).json(modules.map(serialize));
    return;
  }

  if (req.method === 'POST') {
    await requireUser(req);
    const tenant = await resolveTenant(req);
    const { routePath, method, code } = req.body ?? {};
    const normalizedRoute = normalizeRoute(routePath);
    const normalizedMethod = normalizeMethod(method);
    const normalizedCode = normalizeCode(code);
    const fileExtension = normalizeFileExtension(req.body?.fileExtension);

    const repo = CoreDataSource.getRepository(ModuleEntity);
    const existing = await repo.findOne({
      where: { tenant: { id: tenant.id }, routePath: normalizedRoute, method: normalizedMethod },
    });
    if (existing) {
      res.status(409).json({ error: 'Module already exists for route/method' });
      return;
    }

    const mod = repo.create({
      routePath: normalizedRoute,
      method: normalizedMethod,
      code: normalizedCode,
      fileExtension,
      draftVersion: generateVersion(),
      tenant,
    });
    await repo.save(mod);
    await ensureAclEndpoint(tenant as Tenant, normalizedRoute);
    res.status(201).json(serialize(mod));
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
