import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { CoreDataSource, ensureCoreSchema } from '@/lib/core-db';
import { GlobalModulePackage } from '@idp/shared';
import { GlobalModulePackageFile } from '@idp/shared';
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
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    const err = new Error('content must be a string');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeFileExtension = (path: string, raw: unknown) => {
  const normalize = (value?: string) => {
    if (!value) return 'js';
    const cleaned = value.replace(/^\./, '').toLowerCase();
    if (cleaned === 'ts' || cleaned === 'tsx') return 'js';
    return cleaned;
  };
  if (typeof raw === 'string' && raw.trim()) {
    return normalize(raw);
  }
  const ext = path.split('.').pop();
  return normalize(ext);
};

const serialize = (file: GlobalModulePackageFile) => ({
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

  const projectRepo = CoreDataSource.getRepository(GlobalModulePackage);
  const repo = CoreDataSource.getRepository(GlobalModulePackageFile);
  const file = await repo.findOne({
    where: { id: req.query.fileId as string },
    relations: ['project'],
  });
  if (!file) {
    res.status(404).json({ error: 'Shared backend file not found' });
    return;
  }
  if (file.project?.id !== (req.query.id as string)) {
    res.status(404).json({ error: 'Shared backend file not found' });
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
      req.body?.content !== undefined ? normalizeContent(req.body.content) : file.content;
    const nextExtension =
      req.body?.fileExtension !== undefined
        ? normalizeFileExtension(nextPath, req.body.fileExtension)
        : file.fileExtension;

    file.path = nextPath;
    file.content = nextContent;
    file.fileExtension = nextExtension;
    await repo.save(file);

    res.status(200).json({ file: serialize(file) });
    return;
  }

  if (req.method === 'DELETE') {
    if (file.project) {
      ensureSharedProjectEditable(user, file.project);
    }
    await repo.remove(file);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
