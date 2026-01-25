import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@/lib/entities/UIEntities';
import { UIPackageRevision } from '@/lib/entities/UIPackageRevision';
import { resolveTenant } from '@/lib/tenancy';

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
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
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
  const revision = await revRepo.findOne({
    where: { id: req.query.revisionId as string, uiPackage: { id: pkg.id } },
  });
  if (!revision) {
    res.status(404).json({ error: 'Revision not found' });
    return;
  }

  if (revision.name !== pkg.name || revision.version !== pkg.version) {
    const duplicate = await repo.findOne({
      where: { tenant: { id: tenant.id }, name: revision.name, version: revision.version },
    });
    if (duplicate && duplicate.id !== pkg.id) {
      res.status(409).json({ error: 'Another UI entity already uses this name/version' });
      return;
    }
  }

  await createRevision(pkg, tenant, user.id, 'rollback');

  pkg.name = revision.name;
  pkg.version = revision.version;
  pkg.code = revision.code;
  pkg.codeBlob = revision.codeBlob;
  pkg.dependencies = revision.dependencies ?? [];
  pkg.fileExtension = revision.fileExtension;
  await repo.save(pkg);

  res.status(200).json(serialize(pkg));
});
