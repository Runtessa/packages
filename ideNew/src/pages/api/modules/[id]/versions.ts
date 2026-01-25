import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { ModuleEntity } from '@/lib/entities/Module';
import { ModuleRevision } from '@/lib/entities/ModuleRevision';
import { resolveTenant } from '@/lib/tenancy';

const serializeRevision = (rev: ModuleRevision) => ({
  id: rev.id,
  revision: rev.revision,
  routePath: rev.routePath,
  method: rev.method,
  code: rev.code,
  fileExtension: rev.fileExtension,
  action: rev.action,
  createdAt: rev.createdAt,
  createdBy: rev.createdBy ?? undefined,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireUser(req);
  const tenant = await resolveTenant(req);
  const repo = CoreDataSource.getRepository(ModuleEntity);
  const mod = await repo.findOne({
    where: { id: req.query.id as string, tenant: { id: tenant.id } },
  });
  if (!mod) {
    res.status(404).json({ error: 'Module not found' });
    return;
  }

  const revRepo = CoreDataSource.getRepository(ModuleRevision);
  const revisions = await revRepo.find({
    where: { module: { id: mod.id } },
    order: { revision: 'DESC', createdAt: 'DESC' },
  });
  res.status(200).json(revisions.map(serializeRevision));
});
