import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { CoreDataSource } from '@/lib/core-db';
import { OrmModel } from '@idp/shared';
import { resolveTenant } from '@/lib/tenancy';
import { generateVersion } from '@/lib/version';
import { compileOrmSource } from '@/lib/orm-compiler';

const ensureModelPath = (value: string) => {
  const extMatch = value.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${value}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return value.replace(/\.[^.\/]+$/, '.js');
  }
  return value;
};

const normalizePath = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('path is required');
    (err as any).statusCode = 400;
    throw err;
  }
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  return ensureModelPath(trimmed);
};

const normalizeCode = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('code is required');
    (err as any).statusCode = 400;
    throw err;
  }
  return raw;
};

const normalizeFileExtension = (raw: unknown): string => {
  const allowed = new Set(['js']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  if (!allowed.has(normalized)) {
    const err = new Error('Only .js model files are supported.');
    (err as any).statusCode = 400;
    throw err;
  }
  return normalized;
};

const serialize = (model: OrmModel) => ({
  id: model.id,
  path: model.path,
  code: model.code,
  fileExtension: model.fileExtension,
  draftVersion: model.draftVersion,
  createdAt: model.createdAt,
  updatedAt: model.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    await requireUser(req);
    const tenant = await resolveTenant(req);
    const repo = CoreDataSource.getRepository(OrmModel);
    const models = await repo.find({
      where: { tenant: { id: tenant.id } },
      order: { path: 'ASC' },
    });
    res.status(200).json(models.map(serialize));
    return;
  }

  if (req.method === 'POST') {
    await requireUser(req);
    const tenant = await resolveTenant(req);
    const { path, code } = req.body ?? {};
    const normalizedPath = normalizePath(path);
    const normalizedCode = normalizeCode(code);
    const fileExtension = normalizeFileExtension(req.body?.fileExtension);
    let compiled = '';
    try {
      compiled = compileOrmSource(normalizedCode, fileExtension);
    } catch (err) {
      const error = new Error((err as Error).message || 'Failed to compile model');
      (error as any).statusCode = 400;
      throw error;
    }

    const repo = CoreDataSource.getRepository(OrmModel);
    const existing = await repo.findOne({
      where: { tenant: { id: tenant.id }, path: normalizedPath },
    });
    if (existing) {
      res.status(409).json({ error: 'Model already exists at this path' });
      return;
    }

    const model = repo.create({
      tenant,
      path: normalizedPath,
      code: normalizedCode,
      codeBlob: compiled,
      fileExtension,
      draftVersion: generateVersion(),
    });
    await repo.save(model);
    res.status(201).json(serialize(model));
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
