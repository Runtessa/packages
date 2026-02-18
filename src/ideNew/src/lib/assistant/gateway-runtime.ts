import {
  assertRemoteContainerAgentForContainerMode,
  choosePort,
  resolveGatewayHost,
  resolveGatewayImage,
  resolveGatewayMode,
  sanitizeUserKey,
} from '@/lib/assistant/gateway-runtime/config';
import {
  controlRemoteCodexGatewayForUser,
  ensureRemoteCodexGatewayForUser,
  getRemoteCodexGatewayStateForUser,
} from '@/lib/assistant/gateway-runtime/remote-state';
import type {
  CodexGatewayContainerAction,
  CodexGatewayRuntimeState,
  RuntimeInfo,
} from '@/lib/assistant/gateway-runtime/types';
import { maybeNumber } from '@/lib/assistant/gateway-runtime/config';

const HEALTH_TIMEOUT_MS = 20_000;

const waitForHealth = async (baseUrl: string) => {
  const started = Date.now();
  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: 'GET' });
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`gateway health check timed out for ${baseUrl}`);
};

export const resolveCodexGatewayBaseForUser = async (
  userId: string | number,
  userName?: string | null,
): Promise<RuntimeInfo> => {
  const mode = resolveGatewayMode();
  if (mode === 'off' || mode === 'none' || mode === 'disabled') {
    throw new Error('codex gateway mode is disabled');
  }

  if (mode !== 'container') {
    const raw = String(
      process.env.AGENT_CODEX_GATEWAY_URL || process.env.CODEX_GATEWAY_URL || 'http://127.0.0.1:4040',
    ).trim();
    let port = 4040;
    try {
      port = maybeNumber(new URL(raw).port) ?? port;
    } catch {
      // keep fallback
    }
    return {
      baseUrl: raw.replace(/\/+$/, ''),
      engine: 'docker',
      containerName: 'external',
      image: resolveGatewayImage(),
      port,
    };
  }

  assertRemoteContainerAgentForContainerMode(mode);
  const userKey = sanitizeUserKey(userId);
  const safeUserName = String(userName || '');
  const state = await ensureRemoteCodexGatewayForUser(mode, userKey, safeUserName);
  if (!state.running) {
    throw new Error(`remote container-manager returned non-running state for ${state.containerName}`);
  }
  await waitForHealth(state.baseUrl);

  return {
    baseUrl: state.baseUrl,
    engine: state.engine || 'docker',
    containerName: state.containerName,
    image: state.image,
    port: state.port || 4040,
  };
};

export const getCodexGatewayRuntimeStateForUser = async (
  userId: string | number,
  userName?: string | null,
): Promise<CodexGatewayRuntimeState> => {
  const mode = resolveGatewayMode();
  const userKey = sanitizeUserKey(userId);
  const safeUserName = String(userName || '');
  const image = resolveGatewayImage();

  if (mode !== 'container') {
    const raw = String(
      process.env.AGENT_CODEX_GATEWAY_URL || process.env.CODEX_GATEWAY_URL || 'http://127.0.0.1:4040',
    ).trim();
    let host = resolveGatewayHost();
    let port = 4040;
    try {
      const parsed = new URL(raw);
      host = parsed.hostname || host;
      port = maybeNumber(parsed.port) ?? port;
    } catch {
      // keep defaults
    }
    return {
      mode,
      userKey,
      userName: safeUserName,
      containerName: 'external',
      engine: null,
      image,
      host,
      port,
      baseUrl: raw.replace(/\/+$/, ''),
      exists: true,
      running: true,
    };
  }

  assertRemoteContainerAgentForContainerMode(mode);
  return getRemoteCodexGatewayStateForUser(mode, userKey, safeUserName);
};

export const controlCodexGatewayContainerForUser = async (
  userId: string | number,
  userName: string | null | undefined,
  action: CodexGatewayContainerAction,
) => {
  const mode = resolveGatewayMode();
  if (mode !== 'container') {
    throw new Error('Container controls are available only in AGENT_CODEX_GATEWAY_MODE=container');
  }
  assertRemoteContainerAgentForContainerMode(mode);
  const userKey = sanitizeUserKey(userId);
  const safeUserName = String(userName || '');
  return controlRemoteCodexGatewayForUser(mode, userKey, safeUserName, action);
};

export const resolveCodexGatewayModeValue = () => resolveGatewayMode();

export type { CodexGatewayContainerAction, CodexGatewayRuntimeState };
