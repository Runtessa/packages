import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import redis from '@/lib/redis';
import { generateVersion } from '@/lib/version';
import {
  getTailwindPackageName,
  isTailwindPackageName,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import { publishTailwindPackage } from '@/lib/ui-entity-tailwind';

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

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
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

  pkg.publishedVersion = generateVersion();
  pkg.publishedCode = pkg.code;
  pkg.publishedCodeBlob = pkg.codeBlob;
  pkg.publishedDependencies = pkg.dependencies ?? [];
  pkg.publishedFileExtension = pkg.fileExtension;
  pkg.publishedAt = new Date();
  await repo.save(pkg);

  if (!isTailwindPackageName(pkg.name)) {
    await publishTailwindPackage(tenant.id, getTailwindPackageName(pkg.name), pkg.version);
  }

  const encoded = encodeURIComponent(pkg.name);
  await redis.del(
    `registry:tenant:${tenant.id}:${encoded}:latest`,
    `registry:tenant:${tenant.id}:${encoded}:${pkg.version}`
  );

  res.status(200).json(serialize(pkg));
});
