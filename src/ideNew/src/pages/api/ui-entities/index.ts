import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { UIPackage } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import { generateVersion } from '@/lib/version';
import {
  buildTailwindCss,
  ensureTailwindDependency,
  getTailwindPackageName,
  isTailwindConfigName,
  isTailwindPackageName,
  shouldBuildTailwind,
  stripTailwindDependency,
} from '@/lib/tailwindBuilder';
import {
  loadTailwindConfigForTenant,
  rebuildTailwindPackagesForTenant,
  upsertTailwindPackage,
} from '@/lib/ui-entity-tailwind';

const normalizeName = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('name is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const normalizeVersion = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('version is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim();
};

const normalizeSourceCode = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('code is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeCompiledCode = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('codeBlob (compiled output) is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeDependencies = (raw: unknown): string[] => {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    const err = new Error('dependencies must be an array');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.map((item) => String(item));
};

const normalizeFileExtension = (raw: unknown): string => {
  const allowed = new Set(['jsx', 'js', 'json', 'css']);
  if (!raw || typeof raw !== 'string') return 'jsx';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'jsx';
};

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
  if (req.method === 'GET') {
    await requireUser(req);
    const tenant = await resolveTenant(req);
    const repo = CoreDataSource.getRepository(UIPackage);
    const packages = await repo.find({
      where: { tenant: { id: tenant.id } },
      order: { name: 'ASC', version: 'DESC' },
    });
    res.status(200).json(packages.filter((pkg) => !isTailwindPackageName(pkg.name)).map(serialize));
    return;
  }

  if (req.method === 'POST') {
    await requireUser(req);
    const tenant = await resolveTenant(req);
    const { name, version, codeBlob, dependencies } = req.body ?? {};
    const normalizedName = normalizeName(name);
    const normalizedVersion = normalizeVersion(version);
    const normalizedCode = normalizeSourceCode(req.body?.code ?? codeBlob);
    const compiledCode = normalizeCompiledCode(req.body?.codeBlob ?? codeBlob ?? normalizedCode);
    const normalizedDeps = normalizeDependencies(dependencies);
    const fileExtension = normalizeFileExtension(req.body?.fileExtension);
    const usesTailwind =
      shouldBuildTailwind(fileExtension) && !isTailwindConfigName(normalizedName);
    const tailwindName = getTailwindPackageName(normalizedName);
    const depsWithTailwind = usesTailwind
      ? ensureTailwindDependency(normalizedDeps, tailwindName)
      : stripTailwindDependency(normalizedDeps, tailwindName);
    const tailwindConfig = usesTailwind
      ? await loadTailwindConfigForTenant(tenant.id)
      : null;
    const tailwindCss = usesTailwind
      ? await buildTailwindCss(normalizedCode, fileExtension, tailwindConfig ?? undefined)
      : '';

    const repo = CoreDataSource.getRepository(UIPackage);
    const existing = await repo.findOne({
      where: { tenant: { id: tenant.id }, name: normalizedName, version: normalizedVersion },
    });
    if (existing) {
      res.status(409).json({ error: 'UI entity already exists with this name/version' });
      return;
    }

    const pkg = repo.create({
      name: normalizedName,
      version: normalizedVersion,
      code: normalizedCode,
      codeBlob: compiledCode,
      dependencies: depsWithTailwind,
      fileExtension,
      draftVersion: generateVersion(),
      tenant,
    });
    await repo.save(pkg);
    if (usesTailwind) {
      await upsertTailwindPackage(tenant.id, tailwindName, normalizedVersion, tailwindCss);
    }
    if (isTailwindConfigName(normalizedName)) {
      await rebuildTailwindPackagesForTenant(tenant.id);
    }
    res.status(201).json(serialize(pkg));
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
