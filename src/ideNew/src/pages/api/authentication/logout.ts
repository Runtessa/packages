import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '../../../lib/api-helpers';
import { getSessionTokenFromRequest, requireUser } from '../../../lib/auth';
import { AppDataSource, ensureSchema } from '../../../lib/db';
import { LoginSession } from '@idp/shared';
import redis from '../../../lib/redis';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  await requireUser(req);
  const sessionToken = getSessionTokenFromRequest(req);
  if (sessionToken) {
    await ensureSchema();
    const repo = AppDataSource.getRepository(LoginSession);
    await repo.delete({ token: sessionToken });
    await redis.del(`session:${sessionToken}`);
    await redis.del(`session:team:${sessionToken}`);
  }
  res.status(200).json({ ok: true });
});
