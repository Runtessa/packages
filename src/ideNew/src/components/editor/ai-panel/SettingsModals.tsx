import { FiDownload, FiMaximize2 } from 'react-icons/fi';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { CodexSettingsCard } from './CodexSettingsCard';
import {
  MonacoEditor,
  type AiSettings,
  type CodexGatewayAction,
  type CodexGatewayRuntime,
  type CodexLoginSession,
} from './shared';

type SettingsModalsProps = {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  promptMaximized: boolean;
  setPromptMaximized: (open: boolean) => void;
  loadModels: () => void;
  models: string[];
  loadingModels: boolean;
  agentType: string;
  codexAuthLoggedIn: boolean;
  codexAuthChecking: boolean;
  codexAuthStarting: boolean;
  codexAuthStatus: string;
  codexSession: CodexLoginSession | null;
  codexRuntime: CodexGatewayRuntime | null;
  codexRuntimeAction: CodexGatewayAction | null;
  codexRuntimeStatus: string;
  loadCodexAuthStatus: (silent?: boolean) => Promise<void>;
  startCodexLogin: () => Promise<void>;
  sendCodexCallback: () => Promise<void>;
  logoutCodex: () => Promise<void>;
  loadCodexRuntime: (silent?: boolean) => Promise<void>;
  runCodexRuntimeAction: (action: CodexGatewayAction) => Promise<void>;
  settings: AiSettings;
  setSettings: (updater: (prev: AiSettings) => AiSettings) => void;
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
  defaultSystemPrompt: string;
  downloadTenantDump: () => Promise<void>;
  exportingDump: boolean;
};

export function SettingsModals({
  settingsOpen,
  setSettingsOpen,
  promptMaximized,
  setPromptMaximized,
  loadModels,
  models,
  loadingModels,
  agentType,
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
  settings,
  setSettings,
  systemPrompt,
  setSystemPrompt,
  defaultSystemPrompt,
  downloadTenantDump,
  exportingDump,
}: SettingsModalsProps) {
  return (
    <>
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Assistant settings"
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                loadModels();
              }}
            >
              Refresh models
            </Button>
            <Button variant="primary" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {agentType === 'codex' ? (
            <CodexSettingsCard
              codexAuthLoggedIn={codexAuthLoggedIn}
              codexAuthChecking={codexAuthChecking}
              codexAuthStarting={codexAuthStarting}
              codexAuthStatus={codexAuthStatus}
              codexSession={codexSession}
              codexRuntime={codexRuntime}
              codexRuntimeAction={codexRuntimeAction}
              codexRuntimeStatus={codexRuntimeStatus}
              loadCodexAuthStatus={() => loadCodexAuthStatus()}
              startCodexLogin={startCodexLogin}
              sendCodexCallback={sendCodexCallback}
              logoutCodex={logoutCodex}
              loadCodexRuntime={() => loadCodexRuntime()}
              runCodexRuntimeAction={runCodexRuntimeAction}
            />
          ) : null}
          <div className="rounded-lg border border-borderSubtle bg-bgApp px-3 py-2 text-xs text-textMuted">
            {settings.allowClientConfig
              ? 'Client-side overrides are enabled for this tenant.'
              : 'Settings are managed by server env (AI_ALLOW_CLIENT_CONFIG=false).'}
          </div>
          <div className="rounded-lg border border-[#2a2d2e] bg-[#171717] px-3 py-2 text-xs text-gray-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-[#3b3b3b] bg-[#111111] text-[#3b82f6]"
                checked={settings.watchPreviewExceptions}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    watchPreviewExceptions: event.target.checked,
                  }))
                }
              />
              <span>Watch preview exceptions and include them in agent context</span>
            </label>
            <div className="mt-1 text-[10px] text-gray-400">
              Captures runtime/UI/API errors from preview iframe while you test.
            </div>
          </div>
          {agentType !== 'codex' ? (
            <>
              <Input
                label="Base URL"
                value={settings.baseUrl}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, baseUrl: event.target.value }))
                }
                placeholder="https://api.openai.com/v1"
                disabled={!settings.allowClientConfig}
              />
              <Input
                label="API Key"
                type="password"
                value={settings.apiKey}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, apiKey: event.target.value }))
                }
                placeholder="sk-..."
                disabled={!settings.allowClientConfig}
              />
            </>
          ) : null}
          <Select
            label="Model"
            value={settings.model}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, model: event.target.value }))
            }
            options={
              loadingModels
                ? [{ label: 'Loading models…', value: settings.model || '' }]
                : models.length
                  ? models.map((model) => ({ label: model, value: model }))
                  : [
                      {
                        label: settings.model || 'default',
                        value: settings.model || '',
                      },
                    ]
            }
            disabled={!settings.allowClientConfig && !settings.model}
          />
          <Input
            label="Provider override (optional)"
            value={settings.provider}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, provider: event.target.value }))
            }
            placeholder="openai"
            disabled={!settings.allowClientConfig}
          />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-textPrimary">
                System Prompt
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={downloadTenantDump}
                  disabled={exportingDump}
                  className="!px-2"
                  title="Download full tenant markdown dump"
                >
                  <FiDownload className="h-3 w-3" />
                  {exportingDump ? 'Exporting...' : 'Tenant dump'}
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    setPromptMaximized(true);
                    setSettingsOpen(false);
                  }}
                  className="!px-2"
                  title="Maximize system prompt"
                >
                  <FiMaximize2 className="h-3 w-3" />
                  Maximize
                </Button>
              </div>
            </div>
            <div className="overflow-hidden rounded border border-[#2a2d2e]">
              <MonacoEditor
                height="320px"
                language="markdown"
                theme="vs-dark"
                value={systemPrompt}
                onChange={(value) => setSystemPrompt(String(value ?? ''))}
                options={{
                  readOnly: false,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  fontSize: 12,
                }}
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={promptMaximized}
        onClose={() => setPromptMaximized(false)}
        title="System Prompt"
        size="xl"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setSystemPrompt(defaultSystemPrompt || '')}
            >
              Reset default
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setPromptMaximized(false);
                setSettingsOpen(true);
              }}
            >
              Back to settings
            </Button>
            <Button variant="primary" onClick={() => setPromptMaximized(false)}>
              Close
            </Button>
          </>
        }
      >
        <div className="overflow-hidden rounded border border-[#2a2d2e]">
          <MonacoEditor
            height="70vh"
            language="markdown"
            theme="vs-dark"
            value={systemPrompt}
            onChange={(value) => setSystemPrompt(String(value ?? ''))}
            options={{
              readOnly: false,
              minimap: { enabled: true },
              wordWrap: 'on',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              fontSize: 12,
            }}
          />
        </div>
      </Modal>
    </>
  );
}
