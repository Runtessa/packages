import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireUser(req);

  res.status(200).json({
    allowClientConfig: process.env.AI_ALLOW_CLIENT_CONFIG === 'true',
    baseUrl: process.env.AI_BASE_URL ?? '',
    model: process.env.AI_MODEL ?? '',
    provider: process.env.AI_PROVIDER ?? '',
    hasApiKey: Boolean(process.env.AI_API_KEY),
  });
});

