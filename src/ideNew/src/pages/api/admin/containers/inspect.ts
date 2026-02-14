import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { callContainerManager, hasContainerManager } from '@/lib/container-manager-client';

const firstString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? String(value[0] || '') : String(value || '');

type InspectPayload = {
  ok?: boolean;
  containerName?: string;
  inspect?: Record<string, unknown>;
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

  const data = await callContainerManager<InspectPayload>(
    `/v1/containers/${encodeURIComponent(containerName)}/inspect`,
    { method: 'GET' }
  );

  res.status(200).json({
    ok: true,
    containerName: String(data?.containerName || containerName),
    inspect: data?.inspect || null,
  });
});
