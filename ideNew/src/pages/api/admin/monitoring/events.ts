import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { monitoringStore } from '@/lib/monitoring-store';

const toNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toPage = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value;
  return Math.max(Math.floor(toNumber(raw, 1)), 1);
};

const toLimit = (value: unknown) => {
  const raw = Array.isArray(value) ? value[0] : value;
  return Math.min(Math.max(Math.floor(toNumber(raw, 25)), 1), 200);
};

const str = (value: unknown) => {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);

  const page = toPage(req.query.page);
  const limit = toLimit(req.query.limit);
  const minutes = Math.min(Math.max(toNumber(req.query.minutes, 60), 5), 24 * 60);
  const severity = str(req.query.severity).trim();
  const status = str(req.query.status).trim();
  const tenantId = str(req.query.tenantId).trim();
  const serverName = str(req.query.serverName).trim();
  const instanceId = str(req.query.instanceId).trim();
  const sinceTs = Date.now() - minutes * 60_000;

  const all = await monitoringStore.readAlerts(5000);

  const filtered = all
    .filter((event) => {
      const ts = new Date(event.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < sinceTs) return false;
      if (severity && event.severity !== severity) return false;
      if (status && event.status !== status) return false;
      if (tenantId && event.tenantId !== tenantId) return false;
      if (serverName && event.serverName !== serverName) return false;
      if (instanceId && event.instanceId !== instanceId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = filtered.length;
  const start = (page - 1) * limit;
  const events = filtered.slice(start, start + limit);

  res.status(200).json({ page, limit, total, events });
});
