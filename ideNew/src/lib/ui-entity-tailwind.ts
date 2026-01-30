import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@idp/shared';
import redis from '@/lib/redis';
import { generateVersion } from '@/lib/version';
import { ILike, In } from 'typeorm';
import {
  buildTailwindCss,
  getTailwindPackageName,
  isTailwindConfigName,
  isTailwindPackageName,
  parseTailwindConfig,
  shouldBuildTailwind,
} from '@/lib/tailwindBuilder';

export const registryCacheKey = (tenantId: string, name: string, version: string) =>
  `registry:tenant:${tenantId}:${encodeURIComponent(name)}:${version}`;

export const clearRegistryCache = async (tenantId: string, name: string, version: string) => {
  await redis.del(
    registryCacheKey(tenantId, name, 'latest'),
    registryCacheKey(tenantId, name, version)
  );
};

export const upsertTailwindPackage = async (
  tenantId: string,
  name: string,
  version: string,
  css: string
) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  let pkg = await repo.findOne({
    where: { tenant: { id: tenantId }, name, version },
  });
  if (!pkg) {
    pkg = repo.create({
      tenant: { id: tenantId } as UIPackage['tenant'],
      name,
      version,
      code: css,
      codeBlob: css,
      dependencies: [],
      fileExtension: 'css',
      draftVersion: generateVersion(),
    });
  } else {
    pkg.code = css;
    pkg.codeBlob = css;
    pkg.dependencies = [];
    pkg.fileExtension = 'css';
    pkg.draftVersion = generateVersion();
  }
  await repo.save(pkg);
  await clearRegistryCache(tenantId, name, version);
  return pkg;
};

export const removeTailwindPackage = async (
  tenantId: string,
  name: string,
  version: string
) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const pkg = await repo.findOne({
    where: { tenant: { id: tenantId }, name, version },
  });
  if (!pkg) return;
  await clearRegistryCache(tenantId, name, version);
  await repo.remove(pkg);
};

export const publishTailwindPackage = async (
  tenantId: string,
  name: string,
  version: string
) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const pkg = await repo.findOne({
    where: { tenant: { id: tenantId }, name, version },
  });
  if (!pkg) return null;

  pkg.publishedVersion = generateVersion();
  pkg.publishedCode = pkg.code;
  pkg.publishedCodeBlob = pkg.codeBlob;
  pkg.publishedDependencies = [];
  pkg.publishedFileExtension = pkg.fileExtension;
  pkg.publishedAt = new Date();
  await repo.save(pkg);
  await clearRegistryCache(tenantId, name, version);
  return pkg;
};

export const loadTailwindConfigForTenant = async (tenantId: string) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const candidates = await repo.find({
    where: [
      {
        tenant: { id: tenantId },
        name: In([
          'tailwind.config',
          'tailwind.config.js',
          'tailwind.config.cjs',
          'tailwind.config.mjs',
          'tailwind.config.json',
        ]),
      },
      {
        tenant: { id: tenantId },
        name: ILike('%tailwind.config%'),
      },
    ],
    order: { updatedAt: 'DESC' },
    take: 5,
  });
  const configPkg = candidates.find((pkg) => isTailwindConfigName(pkg.name));
  if (!configPkg) return null;
  const source = configPkg.code ?? configPkg.codeBlob ?? '';
  return parseTailwindConfig(source);
};

export const rebuildTailwindPackagesForTenant = async (tenantId: string) => {
  const repo = CoreDataSource.getRepository(UIPackage);
  const packages = await repo.find({ where: { tenant: { id: tenantId } } });
  const config = await loadTailwindConfigForTenant(tenantId);
  const buildTargets = packages.filter(
    (pkg) =>
      !isTailwindPackageName(pkg.name) &&
      !isTailwindConfigName(pkg.name) &&
      shouldBuildTailwind(pkg.fileExtension)
  );
  for (const pkg of buildTargets) {
    const source = pkg.code ?? pkg.codeBlob ?? '';
    const css = await buildTailwindCss(source, pkg.fileExtension, config ?? undefined);
    await upsertTailwindPackage(
      tenantId,
      getTailwindPackageName(pkg.name),
      pkg.version,
      css
    );
  }
};
