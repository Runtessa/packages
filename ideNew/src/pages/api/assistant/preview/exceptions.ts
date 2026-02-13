import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import {
  appendPreviewExceptions,
  clearPreviewExceptions,
  listPreviewExceptions,
} from '@/lib/assistant/preview-exceptions-store';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const tenant = await resolveTenant(req);
  const userId = String(user.id);
  const tenantId = tenant.id;

  if (req.method === 'GET') {
    const limit = Number(req.query.limit ?? 20);
    const items = await listPreviewExceptions(tenantId, userId, limit);
    res.status(200).json({ ok: true, items, count: items.length });
    return;
  }

  if (req.method === 'DELETE') {
    await clearPreviewExceptions(tenantId, userId);
    res.status(200).json({ ok: true, cleared: true });
    return;
  }

  const body = (req.body || {}) as Record<string, unknown>;
  const eventsRaw = Array.isArray(body.events)
    ? body.events
    : body.event
      ? [body.event]
      : [];
  const accepted = await appendPreviewExceptions(tenantId, userId, eventsRaw);
  res.status(200).json({ ok: true, accepted });
});

