import { CoreDataSource } from '@/lib/core-db';
import { GlobalUIPackage } from '@/lib/entities/GlobalUIPackage';
import { GlobalUIPackageFile } from '@/lib/entities/GlobalUIPackageFile';
import redis from '@/lib/redis';
import { generateVersion } from '@/lib/version';
import {
  TailwindSource,
  buildTailwindCss,
  isTailwindConfigPath,
  parseTailwindConfig,
} from '@/lib/tailwindBuilder';

const normalizeSharedExtension = (path: string, explicit?: string) => {
  const normalized = explicit?.replace(/^\./, '').toLowerCase();
  if (normalized) return normalized;
  const idx = path.lastIndexOf('.');
  if (idx !== -1 && idx < path.length - 1) {
    return path.slice(idx + 1).toLowerCase();
  }
  return 'tsx';
};

export const buildTailwindSourcesFromFiles = (files: GlobalUIPackageFile[]) => {
  const sources: TailwindSource[] = [];
  files.forEach((file) => {
    if (isTailwindConfigPath(file.path || '')) return;
    const ext = normalizeSharedExtension(file.path || '', file.fileExtension);
    if (ext === 'css') return;
    sources.push({
      raw: file.content ?? '',
      extension: ext,
    });
  });
  return sources;
};

export const getTailwindConfigFromFiles = (files: GlobalUIPackageFile[]) => {
  const configFile = files.find((file) => isTailwindConfigPath(file.path || ''));
  if (!configFile) return null;
  return parseTailwindConfig(configFile.content ?? '');
};

export const buildTailwindCssFromFiles = async (files: GlobalUIPackageFile[]) => {
  const sources = buildTailwindSourcesFromFiles(files);
  if (!sources.length) return '';
  const config = getTailwindConfigFromFiles(files);
  return buildTailwindCss(sources, undefined, config ?? undefined);
};

const registryCacheKey = (name: string, version: string) =>
  `registry:global:${encodeURIComponent(name)}:${version}`;

const clearRegistryCache = async (name: string, version: string) => {
  await redis.del(registryCacheKey(name, 'latest'), registryCacheKey(name, version));
};

export const upsertGlobalTailwindPackage = async (
  name: string,
  version: string,
  css: string
) => {
  const repo = CoreDataSource.getRepository(GlobalUIPackage);
  let pkg = await repo.findOne({ where: { name, version } });
  if (!pkg) {
    pkg = repo.create({
      name,
      version,
      entryPath: 'styles.css',
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
  return pkg;
};

export const removeGlobalTailwindPackage = async (name: string, version: string) => {
  const repo = CoreDataSource.getRepository(GlobalUIPackage);
  const pkg = await repo.findOne({ where: { name, version } });
  if (!pkg) return;
  await clearRegistryCache(name, version);
  await repo.remove(pkg);
};

export const publishGlobalTailwindPackage = async (name: string, version: string) => {
  const repo = CoreDataSource.getRepository(GlobalUIPackage);
  const pkg = await repo.findOne({ where: { name, version } });
  if (!pkg) return null;
  pkg.publishedVersion = generateVersion();
  pkg.publishedCode = pkg.code;
  pkg.publishedCodeBlob = pkg.codeBlob;
  pkg.publishedDependencies = [];
  pkg.publishedFileExtension = pkg.fileExtension;
  pkg.publishedAt = new Date();
  await repo.save(pkg);
  await clearRegistryCache(name, version);
  return pkg;
};
