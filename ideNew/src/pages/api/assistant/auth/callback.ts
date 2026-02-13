import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveCodexGatewayBaseForUser } from '@/lib/assistant/gateway-runtime';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const runtime = await resolveCodexGatewayBaseForUser(String(user.id), user.email);
  const base = runtime.baseUrl;

  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) {
    const err = new Error('sessionId is required');
    (err as any).statusCode = 400;
    throw err;
  }

  const callbackData =
    req.body?.callbackData && typeof req.body.callbackData === 'object'
      ? req.body.callbackData
      : {};

  let response: Response;
  try {
    response = await fetch(`${base}/v1/login/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        callbackData,
      }),
    });
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
