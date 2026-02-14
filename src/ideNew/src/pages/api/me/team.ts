import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import {
  getSessionTokenFromRequest,
  requireUser,
  setActiveTeamForSession,
} from '@/lib/auth';

const parseTeamId = (raw: unknown) => {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const err = new Error('teamId must be a positive integer');
    (err as any).statusCode = 400;
    throw err;
  }
  return parsed;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    const err = new Error('Session token is required');
    (err as any).statusCode = 400;
    throw err;
  }

  const teamId = parseTeamId(req.body?.teamId);
  const activeTeam = await setActiveTeamForSession(sessionToken, user.id, teamId);
  res.status(200).json({
    ok: true,
    activeTeam,
  });
});
