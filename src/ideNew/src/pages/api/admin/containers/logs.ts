import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { callContainerManager, hasContainerManager } from '@/lib/container-manager-client';

const firstString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? String(value[0] || '') : String(value || '');

type LogsPayload = {
  ok?: boolean;
  containerName?: string;
  tail?: number;
  logs?: string;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);

  if (!hasContainerManager()) {
    res.status(400).json({
      ok: false,
      error: 'AGENT_CONTAINER_MANAGER_URL is not configured',
    });
    return;
  }

  const containerName = firstString(req.query.containerName).trim();
  if (!containerName) {
    res.status(400).json({ ok: false, error: 'containerName is required' });
    return;
  }

  const tailRaw = Number(firstString(req.query.tail || '200'));
  const tail = Number.isFinite(tailRaw) ? Math.min(Math.max(Math.floor(tailRaw), 1), 5000) : 200;
  const sinceRaw = Number(firstString(req.query.since || '0'));
  const since = Number.isFinite(sinceRaw) ? Math.max(Math.floor(sinceRaw), 0) : 0;
  const qs = new URLSearchParams({ tail: String(tail) });
  if (since > 0) qs.set('since', String(since));

  const data = await callContainerManager<LogsPayload>(
    `/v1/containers/${encodeURIComponent(containerName)}/logs?${qs.toString()}`,
    { method: 'GET' }
  );

  res.status(200).json({
    ok: true,
    containerName: String(data?.containerName || containerName),
    tail: Number(data?.tail || tail),
    logs: String(data?.logs || ''),
  });
});
