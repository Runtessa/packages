import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalUIPackage } from '@idp/shared';
import { GlobalUIPackageFile } from '@idp/shared';
import {
  getTailwindPackageName,
  isTailwindPackageName,
  shouldBuildTailwind,
} from '@/lib/tailwindBuilder';
import { buildTailwindCssFromFiles, upsertGlobalTailwindPackage } from '@/lib/shared-tailwind';
import {
  claimSharedProjectOwnershipIfNeeded,
  ensureSharedProjectEditable,
} from '@/lib/shared-project-access';

const normalizePath = (raw: unknown) => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('path is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw.trim().replace(/\\/g, '/');
};

const normalizeContent = (raw: unknown) => {
  if (typeof raw !== 'string') {
    const err = new Error('content is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeFileExtension = (path: string, raw: unknown) => {
  const normalize = (value?: string) => {
    if (!value) return 'jsx';
    const cleaned = value.replace(/^\./, '').toLowerCase();
    if (cleaned === 'ts' || cleaned === 'tsx') return 'jsx';
    return cleaned;
  };
  if (typeof raw === 'string' && raw.trim()) {
    return normalize(raw);
  }
  const ext = path.split('.').pop();
  return normalize(ext);
};

const serialize = (file: GlobalUIPackageFile) => ({
  id: file.id,
  path: file.path,
  fileExtension: file.fileExtension,
  content: file.content,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const user = await requireAdmin(req);
  await ensureCoreSchema();

  const projectId = req.query.id as string;
  const projectRepo = CoreDataSource.getRepository(GlobalUIPackage);
  const fileRepo = CoreDataSource.getRepository(GlobalUIPackageFile);
  const project = await projectRepo.findOne({ where: { id: projectId } });
  if (!project) {
    res.status(404).json({ error: 'Shared project not found' });
    return;
  }

  if (req.method === 'GET') {
    const files = await fileRepo.find({
      where: { project: { id: project.id } },
      order: { path: 'ASC' },
    });
    res.status(200).json({ files: files.map(serialize) });
    return;
  }

  if (req.method === 'POST') {
    const access = ensureSharedProjectEditable(user, project);
    const claimed = claimSharedProjectOwnershipIfNeeded(project, access);
    if (claimed) {
      await projectRepo.save(project);
    }
    const path = normalizePath(req.body?.path);
    const content = normalizeContent(req.body?.content ?? '');
    const fileExtension = normalizeFileExtension(path, req.body?.fileExtension);

    const existing = await fileRepo.findOne({
      where: { project: { id: project.id }, path },
    });
    if (existing) {
      res.status(409).json({ error: 'File already exists at this path' });
      return;
    }

    const file = fileRepo.create({
      project,
      path,
      fileExtension,
      content,
    });
    await fileRepo.save(file);
    if (
      shouldBuildTailwind(project.fileExtension) &&
      !isTailwindPackageName(project.name)
    ) {
      const files = await fileRepo.find({
        where: { project: { id: project.id } },
        order: { path: 'ASC' },
      });
      const css = await buildTailwindCssFromFiles(files);
      await upsertGlobalTailwindPackage(
        getTailwindPackageName(project.name),
        project.version,
        css
      );
    }
    res.status(201).json({ file: serialize(file) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
