import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage } from '@/lib/entities/GlobalUIPackage';
import redis from '@/lib/redis';
import { generateVersion } from '@/lib/version';
import {
  getTailwindPackageName,
  isTailwindPackageName,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import { publishGlobalTailwindPackage } from '@/lib/shared-tailwind';

const serialize = (pkg: GlobalUIPackage) => ({
  id: pkg.id,
  name: pkg.name,
  version: pkg.version,
  entryPath: pkg.entryPath,
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

  await requireAdmin(req);
  await ensureCoreSchema();

  const repo = CoreDataSource.getRepository(GlobalUIPackage);
  const pkg = await repo.findOne({ where: { id: req.query.id as string } });
  if (!pkg) {
    res.status(404).json({ error: 'Shared package not found' });
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
    await publishGlobalTailwindPackage(getTailwindPackageName(pkg.name), pkg.version);
  }

  const encoded = encodeURIComponent(pkg.name);
  await redis.del(`registry:global:${encoded}:latest`, `registry:global:${encoded}:${pkg.version}`);

  res.status(200).json({ package: serialize(pkg) });
});
