import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@/lib/entities/UIEntities';
import { UIPackageRevision } from '@/lib/entities/UIPackageRevision';
import { resolveTenant } from '@/lib/tenancy';

const serializeRevision = (rev: UIPackageRevision) => ({
  id: rev.id,
  revision: rev.revision,
  name: rev.name,
  version: rev.version,
  code: rev.code,
  codeBlob: rev.codeBlob,
  dependencies: rev.dependencies ?? [],
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
  const repo = CoreDataSource.getRepository(UIPackage);
  const pkg = await repo.findOne({
    where: { id: req.query.id as string, tenant: { id: tenant.id } },
  });
  if (!pkg) {
    res.status(404).json({ error: 'UI entity not found' });
    return;
  }

  const revRepo = CoreDataSource.getRepository(UIPackageRevision);
  const revisions = await revRepo.find({
    where: { uiPackage: { id: pkg.id } },
    order: { revision: 'DESC', createdAt: 'DESC' },
  });
  res.status(200).json(revisions.map(serializeRevision));
});
