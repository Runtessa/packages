import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import {
  controlCodexGatewayContainerForUser,
  getCodexGatewayRuntimeStateForUser,
  type CodexGatewayContainerAction,
} from '@/lib/assistant/gateway-runtime';

type GatewayVersionPayload = {
  service?: string;
  version?: string;
  startedAt?: string;
  uptimeMs?: number;
};

const fetchGatewayVersion = async (
  baseUrl: string
): Promise<{ version: GatewayVersionPayload | null; error: string | null }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${baseUrl}/api/version`, { signal: controller.signal });
    const data = (await response.json().catch(() => ({}))) as GatewayVersionPayload;
    if (!response.ok) {
      return {
        version: null,
        error: `Gateway version request failed (${response.status})`,
      };
    }
    return { version: data, error: null };
  } catch (error) {
    return {
      version: null,
      error: String((error as Error)?.message || error || 'fetch failed'),
    };
  } finally {
    clearTimeout(timer);
  }
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);

  if (req.method === 'GET') {
    const state = await getCodexGatewayRuntimeStateForUser(String(user.id), user.email);
    const versionResult =
      state.running && state.baseUrl
        ? await fetchGatewayVersion(state.baseUrl)
        : { version: null, error: null };
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
      gatewayVersion: versionResult.version,
      gatewayVersionError: versionResult.error,
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
  const versionResult =
    state.running && state.baseUrl
      ? await fetchGatewayVersion(state.baseUrl)
      : { version: null, error: null };
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
    gatewayVersion: versionResult.version,
    gatewayVersionError: versionResult.error,
  });
});
