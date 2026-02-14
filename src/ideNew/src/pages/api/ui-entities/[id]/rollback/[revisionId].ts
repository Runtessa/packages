import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@idp/shared';
import { UIPackageRevision } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import { generateVersion } from '@/lib/version';
import {
  buildTailwindCss,
  ensureTailwindDependency,
  getTailwindPackageName,
  isTailwindConfigName,
  shouldBuildTailwind,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import {
  loadTailwindConfigForTenant,
  rebuildTailwindPackagesForTenant,
  removeTailwindPackage,
  upsertTailwindPackage,
} from '@/lib/ui-entity-tailwind';

const serialize = (pkg: UIPackage) => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  code: pkg.code,
  codeBlob: pkg.codeBlob,
  dependencies: stripTailwindDependency(pkg.dependencies ?? [], getTailwindPackageName(pkg.name)),
  fileExtension: pkg.fileExtension,
  draftVersion: pkg.draftVersion,
  publishedVersion: pkg.publishedVersion ?? undefined,
  publishedAt: pkg.publishedAt ?? undefined,
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
  const previousName = pkg.name;
  const previousVersion = pkg.version;

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
  const usesTailwind =
    shouldBuildTailwind(revision.fileExtension) &&
    !isTailwindConfigName(revision.name);
  const nextTailwindName = getTailwindPackageName(revision.name);
  const previousTailwindName = getTailwindPackageName(previousName);
  const depsSansTailwind = stripTailwindDependency(
    stripTailwindDependency(revision.dependencies ?? [], previousTailwindName),
    nextTailwindName
  );
  const nextDeps = usesTailwind
    ? ensureTailwindDependency(depsSansTailwind, nextTailwindName)
    : depsSansTailwind;
  const tailwindConfig = usesTailwind
    ? await loadTailwindConfigForTenant(tenant.id)
    : null;
  const tailwindCss = usesTailwind
    ? await buildTailwindCss(
        revision.code,
        revision.fileExtension,
        tailwindConfig ?? undefined
      )
    : '';

  pkg.dependencies = nextDeps;
  pkg.fileExtension = revision.fileExtension;
  pkg.draftVersion = generateVersion();
  await repo.save(pkg);

  if (!usesTailwind) {
    await removeTailwindPackage(tenant.id, previousTailwindName, previousVersion);
  } else {
    if (previousTailwindName !== nextTailwindName || previousVersion !== revision.version) {
      await removeTailwindPackage(tenant.id, previousTailwindName, previousVersion);
    }
    await upsertTailwindPackage(tenant.id, nextTailwindName, revision.version, tailwindCss);
  }
  if (isTailwindConfigName(revision.name) || isTailwindConfigName(previousName)) {
    await rebuildTailwindPackagesForTenant(tenant.id);
  }

  res.status(200).json(serialize(pkg));
});
