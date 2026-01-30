import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '../../../lib/api-helpers';
import { requireUser } from '../../../lib/auth';
import { AppDataSource, ensureSchema } from '../../../lib/db';
import { LoginSession } from '@idp/shared';
import redis from '../../../lib/redis';

const extractSessionToken = (req: NextApiRequest) => {
  const header = (req.headers.authorization || req.headers.Authorization) as string | undefined;
  if (header) {
    const [scheme, value] = String(header).split(' ');
    if (scheme?.toLowerCase() === 'session' && value) return value;
  }
  const cookie = req.headers.cookie;
  if (cookie) {
    const match = cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('sessionToken='));
    if (match) return decodeURIComponent(match.split('=')[1] || '');
  }
  return null;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  await requireUser(req);
  const sessionToken = extractSessionToken(req);
  if (sessionToken) {
    await ensureSchema();
    const repo = AppDataSource.getRepository(LoginSession);
    await repo.delete({ token: sessionToken });
    await redis.del(`session:${sessionToken}`);
  }
  res.status(200).json({ ok: true });
});
