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

  const idParam = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = Number(idParam);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const repo = AppDataSource.getRepository(SystemLog);
  const log = await repo.findOne({ where: { id } });
  if (!log) {
    res.status(404).json({ error: 'Log not found' });
    return;
  }

  res.status(200).json({ log });
});
