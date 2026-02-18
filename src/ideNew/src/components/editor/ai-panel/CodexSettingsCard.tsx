import { Button } from '@/components/ui/Button';
import { formatUptime, type CodexGatewayAction, type CodexGatewayRuntime, type CodexLoginSession } from './shared';

type CodexSettingsCardProps = {
  codexAuthLoggedIn: boolean;
  codexAuthChecking: boolean;
  codexAuthStarting: boolean;
  codexAuthStatus: string;
  codexSession: CodexLoginSession | null;
  codexRuntime: CodexGatewayRuntime | null;
  codexRuntimeAction: CodexGatewayAction | null;
  codexRuntimeStatus: string;
  loadCodexAuthStatus: () => Promise<void>;
  startCodexLogin: () => Promise<void>;
  sendCodexCallback: () => Promise<void>;
  logoutCodex: () => Promise<void>;
  loadCodexRuntime: () => Promise<void>;
  runCodexRuntimeAction: (action: CodexGatewayAction) => Promise<void>;
};

export function CodexSettingsCard({
  codexAuthLoggedIn,
  codexAuthChecking,
  codexAuthStarting,
  codexAuthStatus,
  codexSession,
  codexRuntime,
  codexRuntimeAction,
  codexRuntimeStatus,
  loadCodexAuthStatus,
  startCodexLogin,
  sendCodexCallback,
  logoutCodex,
  loadCodexRuntime,
  runCodexRuntimeAction,
}: CodexSettingsCardProps) {
  return (
    <div className="space-y-3 rounded-lg border border-[#2a2d2e] bg-[#171717] p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-100">Codex account</div>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] ${
            codexAuthLoggedIn
              ? 'border-emerald-700/50 bg-emerald-900/30 text-emerald-300'
              : 'border-amber-700/50 bg-amber-900/30 text-amber-300'
          }`}
        >
          {codexAuthLoggedIn ? 'Logged in' : 'Not logged in'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="xs" onClick={loadCodexAuthStatus} disabled={codexAuthChecking}>
          {codexAuthChecking ? 'Checking...' : 'Check status'}
        </Button>
        <Button variant="primary" size="xs" onClick={startCodexLogin} disabled={codexAuthStarting}>
          {codexAuthStarting ? 'Starting...' : 'Login in browser'}
        </Button>
        <Button variant="secondary" size="xs" onClick={logoutCodex}>
          Logout
        </Button>
        {codexSession?.sessionId ? (
          <Button
            variant="secondary"
            size="xs"
            onClick={sendCodexCallback}
            title="Send IDE callback payload to gateway session"
          >
            Send callback
          </Button>
        ) : null}
      </div>

      <div className="rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[11px] text-gray-300">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase text-gray-500">Gateway container</span>
          <span
            className={`rounded border px-2 py-0.5 text-[10px] ${
              codexRuntime?.running
                ? 'border-emerald-700/40 bg-emerald-900/20 text-emerald-300'
                : codexRuntime?.exists
                  ? 'border-amber-700/40 bg-amber-900/20 text-amber-300'
                  : 'border-[#2a2d2e] bg-[#171717] text-gray-400'
            }`}
          >
            {codexRuntime?.running ? 'running' : codexRuntime?.exists ? 'stopped' : 'not created'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1 text-[10px] text-gray-400">
          <div>
            <span className="text-gray-500">Name:</span>{' '}
            <span className="font-mono text-gray-300">{codexRuntime?.containerName || '-'}</span>
          </div>
          <div>
            <span className="text-gray-500">Engine:</span> {codexRuntime?.engine || '-'}{' '}
            <span className="text-gray-500">Port:</span> {codexRuntime?.port ?? '-'}
          </div>
          <div>
            <span className="text-gray-500">Version:</span>{' '}
            <span className="font-mono text-gray-300">{codexRuntime?.gatewayVersion || '-'}</span>
            {codexRuntime?.gatewayService ? (
              <span className="text-gray-500"> ({codexRuntime.gatewayService})</span>
            ) : null}
          </div>
          <div>
            <span className="text-gray-500">Uptime:</span>{' '}
            <span className="text-gray-300">{formatUptime(codexRuntime?.gatewayUptimeMs ?? null)}</span>
          </div>
          <div>
            <span className="text-gray-500">Started:</span>{' '}
            <span className="text-gray-300">
              {codexRuntime?.gatewayStartedAt
                ? new Date(codexRuntime.gatewayStartedAt).toLocaleString()
                : '-'}
            </span>
          </div>
          <div className="break-all">
            <span className="text-gray-500">Base:</span>{' '}
            <span className="font-mono text-gray-300">{codexRuntime?.baseUrl || '-'}</span>
          </div>
          {codexRuntime?.gatewayVersionError ? (
            <div className="break-all text-amber-300">
              <span className="text-gray-500">Version error:</span> {codexRuntime.gatewayVersionError}
            </div>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            onClick={loadCodexRuntime}
            disabled={Boolean(codexRuntimeAction)}
          >
            Refresh runtime
          </Button>
          <Button variant="secondary" size="xs" onClick={() => runCodexRuntimeAction('create')} disabled={Boolean(codexRuntimeAction)}>
            {codexRuntimeAction === 'create' ? 'Creating...' : 'Create'}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => runCodexRuntimeAction('start')}
            disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
          >
            {codexRuntimeAction === 'start' ? 'Starting...' : 'Start'}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => runCodexRuntimeAction('stop')}
            disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
          >
            {codexRuntimeAction === 'stop' ? 'Stopping...' : 'Stop'}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => runCodexRuntimeAction('restart')}
            disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
          >
            {codexRuntimeAction === 'restart' ? 'Restarting...' : 'Restart'}
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => runCodexRuntimeAction('remove')}
            disabled={Boolean(codexRuntimeAction) || !codexRuntime?.exists}
          >
            {codexRuntimeAction === 'remove' ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      </div>

      {codexSession ? (
        <div className="rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[11px] text-gray-300">
          <div>
            <span className="text-gray-500">Session:</span>{' '}
            <span className="font-mono">{codexSession.sessionId}</span>
          </div>
          <div>
            <span className="text-gray-500">Status:</span> {codexSession.status}
          </div>
          {codexSession.userCode ? (
            <div>
              <span className="text-gray-500">Code:</span>{' '}
              <span className="font-mono tracking-wide">{codexSession.userCode}</span>
            </div>
          ) : null}
          {codexSession.authUrl ? (
            <div className="break-all">
              <span className="text-gray-500">URL:</span>{' '}
              <a href={codexSession.authUrl} target="_blank" rel="noreferrer" className="text-[#3b82f6] hover:underline">
                {codexSession.authUrl}
              </a>
            </div>
          ) : null}
          {codexSession.callbackUrl ? (
            <div className="break-all">
              <span className="text-gray-500">Callback:</span>{' '}
              <a
                href={`${codexSession.callbackUrl}?sessionId=${encodeURIComponent(codexSession.sessionId)}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#3b82f6] hover:underline"
              >
                {codexSession.callbackUrl}
              </a>
            </div>
          ) : null}
          {codexSession.logs?.length ? (
            <div className="mt-2 rounded border border-[#2a2d2e] bg-[#0f0f0f] p-2">
              <div className="mb-1 text-[10px] uppercase text-gray-500">Login log</div>
              <div className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-gray-300">
                {codexSession.logs.slice(-20).join('\n')}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {codexAuthStatus ? (
        <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[10px] text-gray-300">
          {codexAuthStatus}
        </div>
      ) : null}
      {codexRuntimeStatus ? (
        <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-[#2a2d2e] bg-[#111111] p-2 text-[10px] text-gray-300">
          {codexRuntimeStatus}
        </div>
      ) : null}
    </div>
  );
}
