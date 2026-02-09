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

  const proto = String(req.headers['x-forwarded-proto'] || 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const callbackUrl = host
    ? `${proto}://${host}/assistant/codex-callback`
    : '/assistant/codex-callback';

  let response: Response;
  try {
    response = await fetch(`${base}/v1/login/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: String(user.id),
        mode: 'device-auth',
        callbackUrl,
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
