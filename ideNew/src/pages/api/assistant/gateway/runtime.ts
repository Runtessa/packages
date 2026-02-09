import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import {
  controlCodexGatewayContainerForUser,
  getCodexGatewayRuntimeStateForUser,
  type CodexGatewayContainerAction,
} from '@/lib/assistant/gateway-runtime';

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);

  if (req.method === 'GET') {
    const state = await getCodexGatewayRuntimeStateForUser(String(user.id), user.email);
    const runtime =
      state.running && state.baseUrl
        ? {
            baseUrl: state.baseUrl,
            engine: state.engine,
            containerName: state.containerName,
            image: state.image,
            port: state.port,
          }
        : null;
    res.status(200).json({
      ok: true,
      runtime,
      state,
    });
    return;
  }

  const action = String(req.body?.action || '').trim().toLowerCase() as CodexGatewayContainerAction;
  const allowed = new Set<CodexGatewayContainerAction>([
    'create',
    'start',
    'stop',
    'restart',
    'remove',
  ]);
  if (!allowed.has(action)) {
    res.status(400).json({
      ok: false,
      error: 'Invalid action. Use create/start/stop/restart/remove.',
    });
    return;
  }

  const state = await controlCodexGatewayContainerForUser(
    String(user.id),
    user.email,
    action,
  );
  const runtime =
    state.running && state.baseUrl
      ? {
          baseUrl: state.baseUrl,
          engine: state.engine,
          containerName: state.containerName,
          image: state.image,
          port: state.port,
        }
      : null;
  res.status(200).json({
    ok: true,
    action,
    runtime,
    state,
  });
});
