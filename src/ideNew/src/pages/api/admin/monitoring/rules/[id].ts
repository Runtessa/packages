import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { proxyMonitoringRequest } from '@/lib/monitoring-server-client';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'PUT' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['PUT', 'DELETE']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);

  const id = String(req.query.id || '').trim();
  if (!id) {
    res.status(400).json({ error: 'Rule id is required' });
    return;
  }

  await proxyMonitoringRequest(req, res, {
    path: `/api/admin/monitoring/rules/${encodeURIComponent(id)}`,
  });
});
