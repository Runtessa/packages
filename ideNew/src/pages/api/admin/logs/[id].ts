import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { AppDataSource, ensureSchema } from '@/lib/db';
import { SystemLog } from '@/lib/entities/SystemLog';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);
  const { id } = req.query;
  const logId = Array.isArray(id) ? Number(id[0]) : Number(id);
  if (!logId) {
    res.status(400).json({ error: 'Log id is required' });
    return;
  }

  await ensureSchema();
  const repo = AppDataSource.getRepository(SystemLog);
  const log = await repo.findOne({ where: { id: logId } });

  if (!log) {
    res.status(404).json({ error: 'Log not found' });
    return;
  }

  res.status(200).json({ log });
});
