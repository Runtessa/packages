import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { ModuleEntity } from '@idp/shared';
import { ModuleRevision } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import { generateVersion } from '@/lib/version';

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

const createRevision = async (
  mod: ModuleEntity,
  tenant: { id: string },
  userId: number,
  action: string
) => {
  const revRepo = CoreDataSource.getRepository(ModuleRevision);
  const last = await revRepo.findOne({
    where: { module: { id: mod.id } },
    order: { revision: 'DESC' },
  });
  const revision = revRepo.create({
    module: mod,
    tenant: tenant as any,
    revision: (last?.revision ?? 0) + 1,
    routePath: mod.routePath,
    method: mod.method,
    code: mod.code,
    fileExtension: mod.fileExtension,
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
  const repo = CoreDataSource.getRepository(ModuleEntity);
  const mod = await repo.findOne({
    where: { id: req.query.id as string, tenant: { id: tenant.id } },
  });
  if (!mod) {
    res.status(404).json({ error: 'Module not found' });
    return;
  }

  const revRepo = CoreDataSource.getRepository(ModuleRevision);
  const revision = await revRepo.findOne({
    where: { id: req.query.revisionId as string, module: { id: mod.id } },
  });
  if (!revision) {
    res.status(404).json({ error: 'Revision not found' });
    return;
  }

  if (revision.routePath !== mod.routePath || revision.method !== mod.method) {
    const duplicate = await repo.findOne({
      where: {
        tenant: { id: tenant.id },
        routePath: revision.routePath,
        method: revision.method,
      },
    });
    if (duplicate && duplicate.id !== mod.id) {
      res.status(409).json({ error: 'Another module already uses this route/method' });
      return;
    }
  }

  await createRevision(mod, tenant, user.id, 'rollback');

  mod.routePath = revision.routePath;
  mod.method = revision.method;
  mod.code = revision.code;
  mod.fileExtension = revision.fileExtension;
  mod.draftVersion = generateVersion();
  await repo.save(mod);

  res.status(200).json(serialize(mod));
});
