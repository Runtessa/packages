import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { proxyMonitoringRequest } from '@/lib/monitoring-server-client';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  await proxyMonitoringRequest(req, res, {
    path: '/api/admin/monitoring/ingest',
    allowPassthroughAuth: true,
  });
});
