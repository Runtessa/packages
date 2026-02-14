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
  return ensureModelPath(raw.trim().replace(/\\/g, '/').replace(/^\/+/, ''));
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
  await requireUser(req);
  const tenant = await resolveTenant(req);
  const repo = CoreDataSource.getRepository(OrmModel);
  const id = String(req.query.id || '');

  const model = await repo.findOne({ where: { id, tenant: { id: tenant.id } } });
  if (!model) {
    res.status(404).json({ error: 'Model not found' });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json(serialize(model));
    return;
  }

  if (req.method === 'PUT') {
    const normalizedPath = normalizePath(req.body?.path ?? model.path);
    const normalizedCode = normalizeCode(req.body?.code ?? model.code ?? '');
    const fileExtension = normalizeFileExtension(req.body?.fileExtension ?? model.fileExtension);
    let compiled = '';
    try {
      compiled = compileOrmSource(normalizedCode, fileExtension);
    } catch (err) {
      const error = new Error((err as Error).message || 'Failed to compile model');
      (error as any).statusCode = 400;
      throw error;
    }

    model.path = normalizedPath;
    model.code = normalizedCode;
    model.codeBlob = compiled;
    model.fileExtension = fileExtension;
    model.draftVersion = generateVersion();
    await repo.save(model);
    res.status(200).json(serialize(model));
    return;
  }

  if (req.method === 'DELETE') {
    await repo.remove(model);
    res.status(204).end();
    return;
  }

  res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
  res.status(405).end();
});
