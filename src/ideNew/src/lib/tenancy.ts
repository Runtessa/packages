import { NextApiRequest } from 'next';
import { ensureCoreSchema, CoreDataSource } from './core-db';
import { Tenant } from '@idp/shared';

const normalizeHost = (value: string | undefined | null) => {
  if (!value) return '';
  return value.trim().toLowerCase();
};

export const resolveTenant = async (req: NextApiRequest): Promise<Tenant> => {
  await ensureCoreSchema();

  const headerOverride = normalizeHost(req.headers['x-tenant-host'] as string | undefined);
  const devFallback = normalizeHost(process.env.DEV_TENANT_HOST);

  let hostname = headerOverride || devFallback;

  if (!hostname) {
    const err = new Error('Tenant header required to resolve tenant');
    (err as any).statusCode = 400;
    throw err;
  }

  const tenantRepo = CoreDataSource.getRepository(Tenant);
  const tenant = await tenantRepo.findOne({ where: { hostname } });

  if (!tenant) {
    const err = new Error('Tenant not found');
    (err as any).statusCode = 404;
    throw err;
  }

  if (tenant.isSuspended) {
    const err = new Error('Tenant suspended');
    (err as any).statusCode = 403;
    throw err;
  }

  if (!tenant.resourceConfig) {
    tenant.resourceConfig = { memory: 512, timeout: 5_000 };
  }

  return tenant;
};
