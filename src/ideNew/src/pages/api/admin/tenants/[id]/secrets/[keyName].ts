import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { Secret, Tenant } from '@idp/shared';
import { assertTenantWritableForUser } from '@/lib/team-tenant-access';

const getTenantId = (req: NextApiRequest) => {
  const raw = req.query.id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    const error = new Error('tenant id is required');
    (error as any).statusCode = 400;
    throw error;
  }
  return value;
};

const getKeyName = (req: NextApiRequest) => {
  const raw = req.query.keyName;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    const error = new Error('keyName is required');
    (error as any).statusCode = 400;
    throw error;
  }
  return decodeURIComponent(value);
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    res.status(405).end();
    return;
  }

  const user = await requireAdmin(req);
  await ensureCoreSchema();

  const tenantId = getTenantId(req);
  const keyName = getKeyName(req);

  const tenantRepo = CoreDataSource.getRepository(Tenant);
  const secretRepo = CoreDataSource.getRepository(Secret);

  const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }

  await assertTenantWritableForUser(user, tenant.id);

  const secret = await secretRepo.findOne({
    where: { tenant: { id: tenant.id }, keyName },
  });
  if (!secret) {
    res.status(404).json({ error: 'Secret not found' });
    return;
  }

  await secretRepo.remove(secret);
  res.status(204).end();
});
