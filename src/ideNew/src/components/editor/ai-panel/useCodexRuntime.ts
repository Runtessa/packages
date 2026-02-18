import { useEffect, useRef, useState } from 'react';
import type {
  ApiFetch,
  CodexGatewayAction,
  CodexGatewayRuntime,
  CodexLoginSession,
} from './shared';

type Params = {
  apiFetch: ApiFetch;
  agentType: string;
  settingsOpen: boolean;
  success: (message: string) => void;
  showError: (message: string) => void;
};

type RuntimePayload = {
  state?: unknown;
  gatewayVersion?: unknown;
  gatewayVersionError?: unknown;
};

const toSession = (
  payload: any,
  fallbackSessionId: string,
): CodexLoginSession => ({
  sessionId: String(payload?.sessionId || fallbackSessionId),
  status: String(payload?.status || 'unknown'),
  authUrl: String(payload?.authUrl || ''),
  userCode: String(payload?.userCode || ''),
  callbackUrl: String(payload?.callbackUrl || ''),
  logs: Array.isArray(payload?.logs)
    ? payload.logs.map((entry: unknown) => String(entry))
    : [],
  updatedAt: payload?.updatedAt ? String(payload.updatedAt) : undefined,
  completedAt: payload?.completedAt
    ? String(payload.completedAt)
    : payload?.completedAt === null
      ? null
      : undefined,
});

const toRuntime = (payload: RuntimePayload): CodexGatewayRuntime | null => {
  const state = payload?.state ?? null;
  if (!state || typeof state !== 'object') return null;
  const gatewayVersionPayload =
    payload?.gatewayVersion && typeof payload.gatewayVersion === 'object'
      ? (payload.gatewayVersion as Record<string, unknown>)
      : null;
  const normalizedState = state as Record<string, unknown>;
  return {
    mode: String(normalizedState.mode || ''),
    userKey: String(normalizedState.userKey || ''),
    userName: String(normalizedState.userName || ''),
    containerName: String(normalizedState.containerName || ''),
    engine:
      normalizedState.engine === 'docker' || normalizedState.engine === 'podman'
        ? normalizedState.engine
        : null,
    image: String(normalizedState.image || ''),
    host: String(normalizedState.host || ''),
    port: Number.isFinite(Number(normalizedState.port)) ? Number(normalizedState.port) : null,
    baseUrl: String(normalizedState.baseUrl || ''),
    exists: Boolean(normalizedState.exists),
    running: Boolean(normalizedState.running),
    gatewayVersion: String(gatewayVersionPayload?.version || ''),
    gatewayService: String(gatewayVersionPayload?.service || ''),
    gatewayStartedAt: String(gatewayVersionPayload?.startedAt || ''),
    gatewayUptimeMs: Number.isFinite(Number(gatewayVersionPayload?.uptimeMs))
      ? Number(gatewayVersionPayload?.uptimeMs)
      : null,
    gatewayVersionError: String(payload?.gatewayVersionError || ''),
  };
};

export const useCodexRuntime = ({
  apiFetch,
  agentType,
  settingsOpen,
  success,
  showError,
}: Params) => {
  const [codexAuthChecking, setCodexAuthChecking] = useState(false);
  const [codexAuthStarting, setCodexAuthStarting] = useState(false);
  const [codexAuthLoggedIn, setCodexAuthLoggedIn] = useState(false);
  const [codexAuthStatus, setCodexAuthStatus] = useState('');
  const [codexSession, setCodexSession] = useState<CodexLoginSession | null>(null);
  const [codexRuntime, setCodexRuntime] = useState<CodexGatewayRuntime | null>(null);
  const [codexRuntimeAction, setCodexRuntimeAction] = useState<CodexGatewayAction | null>(null);
  const [codexRuntimeStatus, setCodexRuntimeStatus] = useState('');

  const codexPollTimerRef = useRef<number | null>(null);

  const clearCodexPollTimer = () => {
    if (codexPollTimerRef.current !== null) {
      window.clearInterval(codexPollTimerRef.current);
      codexPollTimerRef.current = null;
    }
  };

  const loadCodexAuthStatus = async (silent = false) => {
    if (agentType !== 'codex') return;
    if (!silent) setCodexAuthChecking(true);
    try {
      const result = await apiFetch('/api/assistant/auth/status');
      setCodexAuthLoggedIn(Boolean(result?.loggedIn));
      setCodexAuthStatus(String(result?.status || ''));
    } catch (err) {
      if (!silent) {
        showError((err as Error).message || 'Failed to load Codex auth status');
      }
    } finally {
      if (!silent) setCodexAuthChecking(false);
    }
  };

  const loadCodexRuntime = async (silent = false) => {
    try {
      const result = (await apiFetch('/api/assistant/gateway/runtime')) as RuntimePayload;
      const nextRuntime = toRuntime(result);
      if (!nextRuntime) return;
      setCodexRuntime(nextRuntime);
      setCodexRuntimeStatus(
        `Container ${nextRuntime.containerName || 'unknown'}: ${
          nextRuntime.running ? 'running' : nextRuntime.exists ? 'stopped' : 'not created'
        }`,
      );
    } catch (err) {
      if (!silent) {
        showError((err as Error).message || 'Failed to load gateway runtime');
      }
    }
  };

  const runCodexRuntimeAction = async (action: CodexGatewayAction) => {
    if (codexRuntimeAction) return;
    setCodexRuntimeAction(action);
    try {
      const result = (await apiFetch('/api/assistant/gateway/runtime', {
        method: 'POST',
        body: { action },
      })) as RuntimePayload;
      const nextRuntime = toRuntime(result);
      if (nextRuntime) {
        setCodexRuntime(nextRuntime);
      }
      setCodexRuntimeStatus(`Container action "${action}" completed`);
      if (action !== 'remove') {
        await loadCodexAuthStatus(true);
      } else {
        setCodexAuthLoggedIn(false);
        setCodexAuthStatus('');
        setCodexSession(null);
      }
      success(`Container ${action} done`);
    } catch (err) {
      showError((err as Error).message || `Failed to ${action} container`);
    } finally {
      setCodexRuntimeAction(null);
    }
  };

  const loadCodexLoginSession = async (sessionId: string, silent = false) => {
    if (!sessionId) return;
    try {
      const result = await apiFetch(
        `/api/assistant/auth/session/${encodeURIComponent(sessionId)}`,
      );
      const nextSession = toSession(result, sessionId);
      setCodexSession(nextSession);
      if (
        nextSession.status === 'completed' ||
        nextSession.status === 'failed' ||
        nextSession.status === 'cancelled'
      ) {
        clearCodexPollTimer();
        void loadCodexAuthStatus(true);
      }
    } catch (err) {
      if (!silent) {
        showError((err as Error).message || 'Failed to load login session');
      }
    }
  };

  const startCodexLogin = async () => {
    if (agentType !== 'codex') return;
    setCodexAuthStarting(true);
    try {
      const result = await apiFetch('/api/assistant/auth/start', {
        method: 'POST',
        body: { mode: 'device-auth' },
      });
      const nextSession = toSession(result, '');
      setCodexSession(nextSession);
      if (nextSession.authUrl) {
        window.open(nextSession.authUrl, '_blank', 'noopener,noreferrer');
      }
      if (!nextSession.authUrl) {
        success('Login session started. Waiting for auth URL...');
      }
      if (nextSession.sessionId) {
        await loadCodexLoginSession(nextSession.sessionId, true);
      }
    } catch (err) {
      showError((err as Error).message || 'Failed to start Codex login');
    } finally {
      setCodexAuthStarting(false);
    }
  };

  const sendCodexCallback = async () => {
    if (!codexSession?.sessionId) return;
    try {
      await apiFetch('/api/assistant/auth/callback', {
        method: 'POST',
        body: {
          sessionId: codexSession.sessionId,
          callbackData: {
            source: 'ide',
            at: new Date().toISOString(),
          },
        },
      });
      await loadCodexLoginSession(codexSession.sessionId, true);
    } catch (err) {
      showError((err as Error).message || 'Failed to send callback payload');
    }
  };

  const logoutCodex = async () => {
    try {
      await apiFetch('/api/assistant/auth/logout', {
        method: 'POST',
        body: {},
      });
      setCodexSession(null);
      clearCodexPollTimer();
      await loadCodexAuthStatus(true);
      success('Logged out from Codex');
    } catch (err) {
      showError((err as Error).message || 'Failed to logout Codex');
    }
  };

  useEffect(() => {
    if (!settingsOpen || agentType !== 'codex') return;
    void loadCodexAuthStatus();
    void loadCodexRuntime(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, agentType]);

  useEffect(() => {
    if (!settingsOpen || agentType !== 'codex') return;
    if (!codexSession?.sessionId) return;
    if (codexSession.status !== 'starting' && codexSession.status !== 'running') {
      clearCodexPollTimer();
      return;
    }
    clearCodexPollTimer();
    codexPollTimerRef.current = window.setInterval(() => {
      void loadCodexLoginSession(codexSession.sessionId, true);
    }, 2000);
    return () => {
      clearCodexPollTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, agentType, codexSession?.sessionId, codexSession?.status]);

  useEffect(() => {
    return () => {
      clearCodexPollTimer();
    };
  }, []);

  return {
    codexAuthChecking,
    codexAuthStarting,
    codexAuthLoggedIn,
    codexAuthStatus,
    codexSession,
    codexRuntime,
    codexRuntimeAction,
    codexRuntimeStatus,
    loadCodexAuthStatus,
    loadCodexRuntime,
    runCodexRuntimeAction,
    startCodexLogin,
    sendCodexCallback,
    logoutCodex,
  };
};
