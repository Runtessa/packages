import { useEffect, useRef, useState } from 'react';
import {
  FiCpu,
  FiMessageSquare,
  FiRefreshCw,
  FiSend,
  FiSettings,
} from 'react-icons/fi';
import type {
  AclConfigDto,
  ActiveFile,
  AssistantFileBlock,
  ModuleDto,
  SharedFileDto,
  SharedProjectDto,
  UIPackageDto,
} from '@/components/editor/types';
import { useToast } from '@/components/ui/Toast';

type AiMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type EditorAiPanelProps = {
  activeFile: ActiveFile | null;
  activeFileContent: string;
  sessionToken: string;
  modules: ModuleDto[];
  uiPackages: UIPackageDto[];
  aclConfig: AclConfigDto | null;
  sharedFiles: SharedFileDto[];
  sharedProject: SharedProjectDto | null;
  sharedMode: 'ui' | 'module' | null;
  getSelectionText: () => string;
  onReplaceActiveFile: (content: string) => void;
  onApplyActions: (blocks: AssistantFileBlock[]) => Promise<{
    applied: number;
    errors: string[];
    report: string;
  }>;
};

const SYSTEM_PROMPT = `You are the AI assistant inside the IDP editor.
The platform is multi-tenant and has:
- Backend Modules (CommonJS): export "module.exports = async function handler(req, adapters) { ... }" and return { statusCode, body }.
- UI Entities (React): main app component is "@app/dashboard" and entry point must be "export function App()" (no default export).
- Shared Projects: file-based projects for UI and backend shared modules.
- ACL configs: permissions.json, roles.json, endpoints.json.
- Tailwind config lives in tailwind.config.js (or .cjs/.ts) inside shared UI projects and MUST exist.

You must always follow this output structure:

Step A: Brainstorming & Planning
Step B: Task Breakdown (markdown checklist)
Step C: File Implementation blocks

Use the exact block format below for each file change:
### FILE: path/to/file.ext
### ACTION: CREATE|EDIT|DELETE
### DESCRIPTION: short note (include id:, version:, deps: if needed)
\`\`\`language
// full file content
\`\`\`

Rules:
- Do NOT include any code outside the file blocks.
- Return as many file blocks as needed (multi-file creation is expected).
- Use "modules/..." paths to edit/create backend modules.
- Use "ui/..." paths to edit/create UI entities (include version in DESCRIPTION if needed).
- Use "acl/permissions.json", "acl/roles.json", "acl/endpoints.json" for ACL edits.
- Use "shared/..." paths for shared project files when in shared mode.
- React and react-dom are global; do NOT list them in deps.
- When UI code imports external packages, include deps in DESCRIPTION: "deps: pkg1, pkg2".
- For updates, include "id: <uuid>" if available (see workspace listing).
- ACL file blocks must contain valid JSON (not a JSON string literal).
- If working in a shared UI project, include tailwind.config.js (or .cjs/.ts) in the file blocks when missing.
`;

const AI_STORAGE_KEY = 'editor-ai-state-v1';

const FILE_BLOCK_REGEX =
  /### FILE:\s*(.*?)\s*\n### ACTION:\s*(CREATE|EDIT|DELETE)\s*\n### DESCRIPTION:\s*(.*?)\s*\n```[\w]*\n([\s\S]*?)```/gi;

const parseFileBlocks = (raw: string): AssistantFileBlock[] => {
  if (!raw) return [];
  FILE_BLOCK_REGEX.lastIndex = 0;
  const blocks: AssistantFileBlock[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = FILE_BLOCK_REGEX.exec(raw))) {
    blocks.push({
      path: match[1].trim(),
      action: match[2].trim().toUpperCase() as AssistantFileBlock['action'],
      description: match[3].trim(),
      content: match[4] ?? '',
    });
  }
  return blocks;
};

const stripFileBlocks = (raw: string) => {
  if (!raw) return '';
  return raw.replace(FILE_BLOCK_REGEX, '').replace(/```[\s\S]*?```/g, '').trim();
};

const splitMessage = (content: string) => {
  const parts = content.split(/(```[\s\S]*?```)/g);
  return parts.filter(Boolean);
};

const checklistRegex = /^\s*[-*]?\s*\[( |x|X)\]\s*(.+)$/;

const renderTextWithChecklist = (text: string, keyBase: string) => {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        if (!line.trim()) {
          return <div key={`${keyBase}-spacer-${index}`} className="h-2" />;
        }
        const match = line.match(checklistRegex);
        if (match) {
          const checked = match[1].toLowerCase() === 'x';
          return (
            <label
              key={`${keyBase}-check-${index}`}
              className="flex items-start gap-2 text-[12px] text-gray-200"
            >
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mt-0.5 h-3.5 w-3.5 rounded border border-[#2a2d2e] bg-[#101214]"
              />
              <span className="leading-relaxed">{match[2]}</span>
            </label>
          );
        }
        return (
          <p key={`${keyBase}-line-${index}`} className="whitespace-pre-wrap">
            {line}
          </p>
        );
      })}
    </div>
  );
};

export function EditorAiPanel({
  activeFile,
  activeFileContent,
  sessionToken,
  modules,
  uiPackages,
  aclConfig,
  sharedFiles,
  sharedProject,
  sharedMode,
  getSelectionText,
  onReplaceActiveFile,
  onApplyActions,
}: EditorAiPanelProps) {
  const { success, error: showError } = useToast();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const includeActiveFile = true;
  const includeSelection = true;
  const includeWorkspaceIndex = true;
  const includeAclJson = true;
  const includeModuleCode = true;
  const includeUiCode = true;
  const includeSharedContents = true;
  const [provider, setProvider] = useState<'openai' | 'ollama'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [showSettings, setShowSettings] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(AI_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.messages)) {
        setMessages(parsed.messages as AiMessage[]);
      }
      if (typeof parsed?.provider === 'string') {
        setProvider(parsed.provider as 'openai' | 'ollama');
      }
      if (typeof parsed?.baseUrl === 'string') setBaseUrl(parsed.baseUrl);
      if (typeof parsed?.model === 'string') setModel(parsed.model);
      if (typeof parsed?.temperature === 'number') setTemperature(parsed.temperature);
    } catch {
      // ignore invalid local storage
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = {
      messages,
      provider,
      baseUrl,
      model,
      temperature,
    };
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(payload));
  }, [messages, provider, baseUrl, model, temperature]);

  useEffect(() => {
    if (provider === 'ollama' && !baseUrl) {
      setBaseUrl('http://localhost:11434');
    }
    if (provider === 'openai' && baseUrl === 'http://localhost:11434') {
      setBaseUrl('');
    }
  }, [provider, baseUrl]);

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sessionToken) headers.Authorization = `Session ${sessionToken}`;
      const res = await fetch('/api/assistant/models', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          baseUrl: baseUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          provider,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load models');
      }
      const list = Array.isArray(data?.models) ? data.models : [];
      setModels(list);
      if (!model && list.length > 0) {
        setModel(list[0]);
      }
    } catch (err) {
      setModelsError((err as Error).message || 'Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  };

  const truncate = (value: string, limit = 6000) => {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}\n// ... truncated`;
  };

  const buildWorkspaceContext = () => {
    const sections: string[] = [];
    if (includeWorkspaceIndex) {
      const moduleLines = modules.map(
        (item) => `${item.method} ${item.routePath} (id:${item.id})`
      );
      sections.push(
        `Modules (${modules.length}):\n${moduleLines.length ? moduleLines.join('\n') : '-' }`
      );
      const uiLines = uiPackages.map(
        (item) => `${item.name}@${item.version} (id:${item.id})`
      );
      sections.push(
        `UI Packages (${uiPackages.length}):\n${uiLines.length ? uiLines.join('\n') : '-' }`
      );
      if (sharedProject) {
        sections.push(
          `Shared Project (${sharedMode ?? 'unknown'}): ${sharedProject.name}@${sharedProject.version}`
        );
      } else {
        sections.push('Shared Project: none');
      }
      const sharedLines = sharedFiles.map((file) => `${file.path} (id:${file.id})`);
      sections.push(
        `Shared Files (${sharedFiles.length}):\n${sharedLines.length ? sharedLines.join('\n') : '-' }`
      );
    }
    if (includeAclJson && aclConfig) {
      sections.push(
        `ACL Permissions:\n\`\`\`json\n${truncate(
          JSON.stringify(aclConfig.permissions ?? {}, null, 2)
        )}\n\`\`\``
      );
      sections.push(
        `ACL Roles:\n\`\`\`json\n${truncate(
          JSON.stringify(aclConfig.roles ?? {}, null, 2)
        )}\n\`\`\``
      );
      sections.push(
        `ACL Endpoints:\n\`\`\`json\n${truncate(
          JSON.stringify(aclConfig.endpoints ?? {}, null, 2)
        )}\n\`\`\``
      );
    }
    if (includeModuleCode && modules.length) {
      const moduleBlocks = modules
        .map((item) => {
          const code = item.code ?? '';
          if (!code.trim()) return null;
          return `// ${item.method} ${item.routePath}\n${truncate(code, 5000)}`;
        })
        .filter(Boolean)
        .join('\n\n');
      if (moduleBlocks) {
        sections.push(`Module Code:\n\`\`\`js\n${moduleBlocks}\n\`\`\``);
      }
    }
    if (includeUiCode && uiPackages.length) {
      const uiBlocks = uiPackages
        .map((item) => {
          const code = item.code ?? '';
          if (!code.trim()) return null;
          return `// ${item.name}@${item.version}\n${truncate(code, 5000)}`;
        })
        .filter(Boolean)
        .join('\n\n');
      if (uiBlocks) {
        sections.push(`UI Code:\n\`\`\`jsx\n${uiBlocks}\n\`\`\``);
      }
    }
    if (includeSharedContents && sharedFiles.length) {
      const sharedBlocks = sharedFiles
        .map((file) => {
          const content = file.content ?? '';
          if (!content.trim()) return null;
          return `// ${file.path}\n${truncate(content, 5000)}`;
        })
        .filter(Boolean)
        .join('\n\n');
      if (sharedBlocks) {
        sections.push(`Shared File Contents:\n\`\`\`\n${sharedBlocks}\n\`\`\``);
      }
    }
    return sections.length ? `\n\nWorkspace:\n${sections.join('\n\n')}` : '';
  };

  const buildContext = () => {
    const parts: string[] = [];
    if (includeActiveFile && activeFile) {
      parts.push(
        `Active file: ${activeFile.name}\n\`\`\`\n${activeFileContent}\n\`\`\``
      );
    }
    if (includeSelection) {
      const selection = getSelectionText();
      if (selection.trim()) {
        parts.push(`Selection:\n\`\`\`\n${selection}\n\`\`\``);
      }
    }
    const workspaceContext = buildWorkspaceContext();
    if (workspaceContext) {
      parts.push(workspaceContext);
    }
    return parts.length ? `\n\nContext:\n${parts.join('\n\n')}` : '';
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: AiMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const payload = {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.map((msg) => ({ role: msg.role, content: msg.content })),
          { role: 'user', content: trimmed + buildContext() },
        ],
        baseUrl: baseUrl.trim() || undefined,
        model: model.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        temperature,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sessionToken) {
        headers.Authorization = `Session ${sessionToken}`;
      }
      const res = await fetch('/api/assistant/respond', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Assistant request failed');
      }
      const rawContent = data?.content || '';
      const blocks = parseFileBlocks(rawContent);
      if (blocks.length === 0) {
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role: 'assistant',
            content: stripFileBlocks(rawContent) || 'No file blocks returned.',
          },
        ]);
        showError('Assistant did not return file blocks.');
        return;
      }

      const result = await onApplyActions(blocks);
      const baseMessage = result.report
        ? result.report
        : result.applied > 0
        ? `Applied ${result.applied} change${result.applied === 1 ? '' : 's'}.`
        : 'No changes were applied.';
      const narrative = stripFileBlocks(rawContent);
      const messageParts = [narrative, baseMessage].filter(Boolean);
      const message = result.errors.length
        ? `${messageParts.join('\n\n')}\n\nErrors:\n- ${result.errors.join('\n- ')}`
        : messageParts.join('\n\n');
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: 'assistant',
          content: message,
        },
      ]);
      if (result.errors.length) {
        showError(result.errors[0]);
      } else if (result.applied > 0) {
        success(baseMessage);
      }
    } catch (err) {
      showError((err as Error).message || 'Assistant failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[34px] items-center justify-between border-b border-[#2a2d2e] px-3 text-[11px] uppercase text-gray-400">
        <div className="flex items-center gap-2">
          <FiMessageSquare className="h-3.5 w-3.5" />
          Assistant
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          {loading ? 'Thinking…' : 'Ready'}
        </div>
      </div>

      <div className="border-b border-[#2a2d2e] px-3 py-2 text-[11px] text-gray-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FiCpu className="h-4 w-4 text-gray-400" />
            <span className="text-gray-200">
              {provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'}
            </span>
            <span className="text-gray-500">•</span>
            <span className="truncate text-gray-400">{model || 'Default model'}</span>
          </div>
          <span className="text-[10px] text-gray-500">
            Temp {temperature.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-3 py-4">
        {messages.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Ask for help, code, or refactors.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-lg border px-3 py-2 text-[12px] ${
                  msg.role === 'assistant'
                    ? 'border-[#2a2d2e] bg-[#1b1b1b] text-gray-200'
                    : 'border-[#1f2f3a] bg-[#0f1c26] text-gray-100'
                }`}
              >
                <div className="mb-1 text-[10px] uppercase text-gray-500">
                  {msg.role === 'assistant' ? 'Assistant' : 'You'}
                </div>
                {splitMessage(msg.content).map((part, idx) => {
                  if (part.startsWith('```')) {
                    const code = part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
                    return (
                      <pre
                        key={`${msg.id}-code-${idx}`}
                        className="overflow-auto rounded-md border border-[#2a2d2e] bg-[#101214] p-2 text-[11px] text-gray-200"
                      >
                        {code.trim()}
                      </pre>
                    );
                  }
                  return (
                    <div key={`${msg.id}-text-${idx}`}>
                      {renderTextWithChecklist(part, `${msg.id}-text-${idx}`)}
                    </div>
                  );
                })}
              </div>
            ))}
            {loading && (
              <div className="rounded-lg border border-[#2a2d2e] bg-[#1b1b1b] px-3 py-2 text-[12px] text-gray-400">
                Assistant is thinking…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-[#2a2d2e] p-3">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          rows={3}
          placeholder="Ask the assistant… (Shift+Enter for new line)"
          className="w-full resize-none rounded border border-[#2a2d2e] bg-[#1b1b1b] px-3 py-2 text-[12px] text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#0b5b96]"
        />
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-gray-400">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center justify-center rounded border border-[#2a2d2e] p-1.5 text-gray-200 hover:bg-[#1f1f1f]"
            aria-label="AI settings"
            title="AI settings"
          >
            <FiSettings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-2 rounded border border-[#2a2d2e] bg-[#0b5b96] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#0f72be] disabled:opacity-60"
          >
            <FiSend className="h-3.5 w-3.5" />
            Send
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xl rounded-xl border border-[#2a2d2e] bg-[#1b1b1b] p-4 text-gray-200 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#2a2d2e] pb-2">
              <div className="text-sm font-semibold">AI Settings</div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded border border-[#2a2d2e] px-2 py-1 text-[11px] text-gray-300 hover:bg-[#242424]"
              >
                Close
              </button>
            </div>
            <div className="mt-3 space-y-3 text-[12px]">
              <div className="flex items-center gap-2">
                <label className="w-28 text-gray-400">Provider</label>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as 'openai' | 'ollama')}
                  className="flex-1 rounded border border-[#2a2d2e] bg-[#111] px-2 py-1 text-[12px]"
                >
                  <option value="openai">OpenAI-compatible</option>
                  <option value="ollama">Ollama (local)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-28 text-gray-400">Base URL</label>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com"
                  className="flex-1 rounded border border-[#2a2d2e] bg-[#111] px-2 py-1 text-[12px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-28 text-gray-400">Model</label>
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gpt-4o-mini"
                  list="ai-model-list"
                  className="flex-1 rounded border border-[#2a2d2e] bg-[#111] px-2 py-1 text-[12px]"
                />
                <datalist id="ai-model-list">
                  {models.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={loadModels}
                  disabled={modelsLoading}
                  className="rounded border border-[#2a2d2e] p-1.5 text-gray-200 hover:bg-[#1f1f1f] disabled:opacity-60"
                  title="Load models"
                  aria-label="Load models"
                >
                  <FiRefreshCw
                    className={`h-4 w-4 ${modelsLoading ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-28 text-gray-400">API Key</label>
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="Optional for local"
                  className="flex-1 rounded border border-[#2a2d2e] bg-[#111] px-2 py-1 text-[12px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-28 text-gray-400">Temperature</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(event) => setTemperature(Number(event.target.value))}
                  className="flex-1"
                />
                <span className="w-10 text-right text-gray-400">
                  {temperature.toFixed(2)}
                </span>
              </div>
              <details className="rounded border border-[#2a2d2e] bg-[#111] px-3 py-2">
                <summary className="cursor-pointer text-[11px] text-gray-400">
                  System prompt (read-only)
                </summary>
                <textarea
                  readOnly
                  value={SYSTEM_PROMPT}
                  rows={10}
                  className="mt-2 w-full resize-none rounded border border-[#2a2d2e] bg-[#0f0f0f] px-2 py-1 text-[11px] text-gray-200"
                />
              </details>
              {modelsError ? (
                <div className="text-[11px] text-red-300">{modelsError}</div>
              ) : models.length > 0 ? (
                <div className="text-[11px] text-gray-500">
                  {models.length} model{models.length === 1 ? '' : 's'} loaded
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
