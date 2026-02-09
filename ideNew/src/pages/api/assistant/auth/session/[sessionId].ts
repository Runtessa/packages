import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveCodexGatewayBaseForUser } from '@/lib/assistant/gateway-runtime';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const runtime = await resolveCodexGatewayBaseForUser(String(user.id), user.email);
  const base = runtime.baseUrl;

  const sessionId = String(req.query.sessionId || '').trim();
  if (!sessionId) {
    const err = new Error('sessionId is required');
    (err as any).statusCode = 400;
    throw err;
  }

  let response: Response;
  try {
    response = await fetch(`${base}/v1/login/session/${encodeURIComponent(sessionId)}`);
  } catch (error) {
    throw new Error(
      `Failed to reach codex gateway at ${base} (${runtime.containerName}:${runtime.port}): ${String(
        (error as Error)?.message || error || 'fetch failed'
      )}`
    );
  }
  const data = await response.json().catch(() => ({}));
  res.status(response.status).json({
    ...data,
    runtime: {
      engine: runtime.engine,
      containerName: runtime.containerName,
      port: runtime.port,
    },
  });
});
