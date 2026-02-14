import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { ModuleEntity } from '@idp/shared';
import { ModuleRevision } from '@idp/shared';
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
  const pageRaw = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(limitRaw ?? '20', 10) || 20));
  const skip = (page - 1) * limit;

  const [revisions, total] = await revRepo.findAndCount({
    where: { module: { id: mod.id } },
    order: { revision: 'DESC', createdAt: 'DESC' },
    skip,
    take: limit,
  });
  res.status(200).json({
    items: revisions.map(serializeRevision),
    total,
    page,
    pageSize: limit,
  });
});
