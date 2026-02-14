import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { proxyMonitoringRequest } from '@/lib/monitoring-server-client';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);
  await proxyMonitoringRequest(req, res, {
    path: '/api/admin/monitoring/rules',
  });
});
