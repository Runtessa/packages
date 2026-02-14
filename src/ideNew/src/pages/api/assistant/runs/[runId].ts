import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { deleteAssistantRun, getAssistantRun } from '@/lib/assistant/state-store';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['GET', 'DELETE']);
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
  if (req.method === 'DELETE') {
    await deleteAssistantRun(tenant.id, runId);
    res.status(204).end();
    return;
  }
  const run = await getAssistantRun(tenant.id, runId);
  if (!run) {
    const error = new Error('Run not found');
    (error as any).statusCode = 404;
    throw error;
  }
  res.status(200).json(run);
});
