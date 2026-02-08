import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { getAssistantRun } from '@/lib/assistant/state-store';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireUser(req);
  const tenant = await resolveTenant(req);
  const runId = String(req.query.runId ?? '').trim();
  if (!runId) {
    const error = new Error('runId is required');
    (error as any).statusCode = 400;
    throw error;
  }
  const run = await getAssistantRun(tenant.id, runId);
  if (!run) {
    const error = new Error('Run not found');
    (error as any).statusCode = 404;
    throw error;
  }
  res.status(200).json(run);
});
