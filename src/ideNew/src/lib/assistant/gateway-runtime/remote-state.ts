import {
  buildContainerName,
  choosePort,
  mapEngine,
  maybeNumber,
  resolveGatewayHost,
  resolveGatewayImage,
} from './config';
import { requestContainerAgent } from './container-agent-client';
import type {
  CodexGatewayContainerAction,
  CodexGatewayRuntimeState,
  RemoteCodexStatePayload,
} from './types';

const toRuntimeStateFromRemote = (
  mode: string,
  userKey: string,
  userName: string,
  state: RemoteCodexStatePayload,
): CodexGatewayRuntimeState => {
  const host = String(state.host || resolveGatewayHost()).trim() || resolveGatewayHost();
  const port = maybeNumber(state.port) ?? choosePort(userKey);
  const baseUrl = String(state.baseUrl || `http://${host}:${port}`).replace(/\/+$/, '');
  return {
    mode,
    userKey,
    userName,
    containerName: String(state.containerName || buildContainerName(userKey, userName)),
    engine: mapEngine(state.engine),
    image: String(state.image || resolveGatewayImage()),
    host,
    port,
    baseUrl,
    exists: Boolean(state.exists),
    running: Boolean(state.running),
  };
};

export const ensureRemoteCodexGatewayForUser = async (
  mode: string,
  userKey: string,
  userName: string,
): Promise<CodexGatewayRuntimeState> => {
  const response = await requestContainerAgent<{ ok?: boolean; state?: RemoteCodexStatePayload }>(
    '/v1/services/codex-gateway/ensure',
    {
      method: 'POST',
      body: JSON.stringify({ userId: userKey, userName }),
    },
  );
  return toRuntimeStateFromRemote(mode, userKey, userName, response.state || {});
};

export const getRemoteCodexGatewayStateForUser = async (
  mode: string,
  userKey: string,
  userName: string,
): Promise<CodexGatewayRuntimeState> => {
  const query = new URLSearchParams({ userId: userKey, userName });
  const response = await requestContainerAgent<{ ok?: boolean; state?: RemoteCodexStatePayload }>(
    `/v1/services/codex-gateway/state?${query.toString()}`,
    { method: 'GET' },
  );
  return toRuntimeStateFromRemote(mode, userKey, userName, response.state || {});
};

export const controlRemoteCodexGatewayForUser = async (
  mode: string,
  userKey: string,
  userName: string,
  action: CodexGatewayContainerAction,
): Promise<CodexGatewayRuntimeState> => {
  const response = await requestContainerAgent<{ ok?: boolean; state?: RemoteCodexStatePayload }>(
    '/v1/services/codex-gateway/action',
    {
      method: 'POST',
      body: JSON.stringify({ action, userId: userKey, userName }),
    },
  );
  return toRuntimeStateFromRemote(mode, userKey, userName, response.state || {});
};
