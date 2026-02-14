import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { SystemLog } from '@idp/shared';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);
  await ensureSchema();

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Number(req.query.limit) || 25, 200);
  const level = Array.isArray(req.query.level) ? req.query.level[0] : req.query.level;
  const source = Array.isArray(req.query.source) ? req.query.source[0] : req.query.source;

  const repo = AppDataSource.getRepository(SystemLog);
  const qb = repo.createQueryBuilder('log');

  if (level) {
    qb.andWhere('log.level = :level', { level });
  }

  if (source) {
    qb.andWhere('log.source = :source', { source });
  }

  const offset = (page - 1) * limit;
  const [logs, total] = await qb
    .orderBy('log.createdAt', 'DESC')
    .skip(offset)
    .take(limit)
    .getManyAndCount();

  res.status(200).json({ logs, total });
});
