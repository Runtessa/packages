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

  const projectRepo = CoreDataSource.getRepository(GlobalUIPackage);
  const fileRepo = CoreDataSource.getRepository(GlobalUIPackageFile);
  const fileId = req.query.fileId as string;
  const file = await fileRepo.findOne({
    where: { id: fileId },
    relations: ['project'],
  });
  if (!file) {
    res.status(404).json({ error: 'Shared project file not found' });
    return;
  }
  if (file.project?.id !== (req.query.id as string)) {
    res.status(404).json({ error: 'Shared project file not found' });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ file: serialize(file) });
    return;
  }

  if (req.method === 'PUT') {
    if (file.project) {
      const access = ensureSharedProjectEditable(user, file.project);
      const claimed = claimSharedProjectOwnershipIfNeeded(file.project, access);
      if (claimed) {
        await projectRepo.save(file.project);
      }
    }
    const nextPath =
      req.body?.path !== undefined ? normalizePath(req.body.path) : file.path;
    const nextContent =
      req.body?.content !== undefined
        ? normalizeContent(req.body.content)
        : file.content;
    const nextExt = normalizeFileExtension(nextPath, req.body?.fileExtension);

    if (nextPath !== file.path) {
      const conflict = await fileRepo.findOne({
        where: { project: { id: file.project?.id }, path: nextPath },
      });
      if (conflict && conflict.id !== file.id) {
        res.status(409).json({ error: 'Another file already uses this path' });
        return;
      }
    }

    file.path = nextPath;
    file.fileExtension = nextExt;
    file.content = nextContent;
    await fileRepo.save(file);
    if (
      file.project &&
      shouldBuildTailwind(file.project.fileExtension) &&
      !isTailwindPackageName(file.project.name)
    ) {
      const files = await fileRepo.find({
        where: { project: { id: file.project.id } },
        order: { path: 'ASC' },
      });
      const css = await buildTailwindCssFromFiles(files);
      await upsertGlobalTailwindPackage(
        getTailwindPackageName(file.project.name),
        file.project.version,
        css
      );
    }
    res.status(200).json({ file: serialize(file) });
    return;
  }

  if (req.method === 'DELETE') {
    if (file.project) {
      ensureSharedProjectEditable(user, file.project);
    }
    await fileRepo.remove(file);
    if (
      file.project &&
      shouldBuildTailwind(file.project.fileExtension) &&
      !isTailwindPackageName(file.project.name)
    ) {
      const files = await fileRepo.find({
        where: { project: { id: file.project.id } },
        order: { path: 'ASC' },
      });
      const css = await buildTailwindCssFromFiles(files);
      await upsertGlobalTailwindPackage(
        getTailwindPackageName(file.project.name),
        file.project.version,
        css
      );
    }
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
