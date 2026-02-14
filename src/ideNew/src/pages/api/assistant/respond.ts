import type { NextApiRequest, NextApiResponse } from 'next';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { CODEX_SYSTEM_INSTRUCTIONS, resolveCodexModelFromEnv } from '@/lib/assistant/codex';
import { resolveCodexGatewayBase } from '@/lib/assistant/gateway';
import {
  resolveCodexGatewayBaseForUser,
  resolveCodexGatewayModeValue,
} from '@/lib/assistant/gateway-runtime';
import { buildAssistantTools } from '@/lib/assistant/tools';
import {
  buildAssistantModelConfig,
  createAssistantAgent,
  ASSISTANT_SYSTEM_INSTRUCTIONS,
} from '@/lib/assistant/agent';
import type { AssistantChange } from '@/lib/assistant/types';
import type { MastraModelConfig } from '@mastra/core/llm';
import { executeAssistantRun, type AssistantRunEvent } from '@/lib/assistant/orchestrator';
import {
  buildAssistantIdempotencyKey,
  completeAssistantRun,
  getAssistantRun,
  getAssistantRunSummary,
  reserveAssistantRun,
  startAssistantRun,
  appendAssistantEvent,
} from '@/lib/assistant/state-store';
import {
  listPreviewExceptions,
  type PreviewExceptionEntry,
} from '@/lib/assistant/preview-exceptions-store';

const MAX_CONTEXT_CHARS = 240000;
const MAX_SYSTEM_PROMPT_CHARS = 120000;
const DEFAULT_UI_VERSION = '1.0.0';
const DEFAULT_UI_CODE = `import React from 'react';
import { useApiClient } from '@app/datacontext';

export function App() {
  const apiClient = useApiClient();
  void apiClient;
  return (
    <div style={{ padding: 24 }}>
      <h1>IDP Dashboard</h1>
    </div>
  );
}
`;
const MAX_REPAIR_ATTEMPTS = 2;

type CodexConflict = {
  id: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  relatedNodeIds: string[];
};

const resolveAgentType = () => (process.env.AGENT_TYPE || '').trim().toLowerCase();
const isCodexAgentMode = () => resolveAgentType() === 'codex';

const resolveCodexCwd = () => {
  const fromEnv = (process.env.AGENT_CODEX_CWD || '').trim();
  if (fromEnv) return fromEnv;
  const cwd = process.cwd().replace(/\\/g, '/');
  if (cwd.endsWith('/src/ideNew')) return cwd.slice(0, -'/src/ideNew'.length);
  if (cwd.endsWith('/ideNew')) return cwd.slice(0, -'/ideNew'.length);
  return cwd;
};

const resolveCodexTimeoutMs = () => {
  const raw = Number(process.env.AGENT_CODEX_TIMEOUT_MS || '0');
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 10 * 60 * 1000;
};

const resolveCodexGatewayUrl = () => resolveCodexGatewayBase();

const resolveCodexModel = (_config: { model?: string } | undefined, _allowClientConfig: boolean) => {
  const codexOnly = resolveCodexModelFromEnv();
  return codexOnly;
};

const createRunEvent = (
  runId: string,
  type: AssistantRunEvent['type'],
  phase: AssistantRunEvent['phase'],
  payload?: Record<string, unknown>
): AssistantRunEvent => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `evt-${Math.random().toString(36).slice(2, 12)}`,
  runId,
  type,
  phase,
  timestamp: new Date().toISOString(),
  payload,
});

const buildCodexPrompt = (
  messages: Array<{ role: string; content: string }>,
  contextText: string,
  systemPrompt: string
) => {
  const codexRuntimeContract = `CODEX HOST EXECUTION CONTRACT (NON-NEGOTIABLE):
- You do NOT have callable tools in this Codex run.
- The host has ALREADY executed workspace/ACL discovery and provided full outputs in FULL WORKSPACE CONTEXT.
- Never ask for list_workspace/get_acl_config/tool availability; never ask user to provide those outputs again.
- Your job is to RETURN JSON operations for the host to execute.
- If the request requires file/workspace changes, output at least one operation.
- If the request is purely conversational, operations may be empty.
- For implementation requests, always return full-stack operations that cover backend modules + ORM models + UI updates + ACL updates.
- No mock/fake/sample/dummy data is allowed anywhere.
- Backend ORM usage rule: only await adapters.orm('<database>:<key>') (bare keys like "pga1" are invalid).
- UI data-access rule: use @app/datacontext (never fetch/axios/XMLHttpRequest).
- Respect actor_access permissions from context. Never emit operations that the actor role cannot execute.
- Return ONLY a single valid JSON object (no markdown, no code fences).

JSON SCHEMA:
{
  "summary": "short human-readable summary",
  "operations": [
    { "tool": "<tool_id>", "input": { ... }, "reason": "optional" }
  ]
}

Valid tool ids:
list_workspace, get_acl_config,
list_models, list_ui_packages, list_shared_ui_projects, list_shared_module_projects,
create_shared_ui_project, create_shared_module_project,
create_module, update_module, delete_module,
create_model, update_model, delete_model,
create_ui_package, update_ui_package, delete_ui_package,
update_acl_file,
write_shared_file, delete_shared_file,
get_module, get_model, get_ui_package, get_shared_file,
create_file, update_file, delete_file
`;

  const history = messages
    .map((msg) => `[${msg.role}] ${msg.content}`)
    .join('\n\n');
  return `${systemPrompt}

${codexRuntimeContract}

RUNTIME MODE:
- You are running in codex-cli mode for chat output.
- Return ONLY valid JSON (no markdown, no code fences).
- Prefer concise, direct output.
- If file changes are requested, produce tool operations to apply them.

OUTPUT CONTRACT (strict JSON object):
{
  "summary": "short human summary",
  "operations": [
    { "tool": "<tool_id>", "input": { ... }, "reason": "optional short note" }
  ]
}

ALLOWED TOOL IDS:
- list_workspace, get_acl_config
- list_models, list_ui_packages
- list_shared_ui_projects, list_shared_module_projects
- create_shared_ui_project, create_shared_module_project
- create_module, update_module, delete_module
- create_model, update_model, delete_model
- create_ui_package, update_ui_package, delete_ui_package
- update_acl_file
- write_shared_file, delete_shared_file
- get_module, get_model, get_ui_package, get_shared_file
- create_file, update_file, delete_file

FULL WORKSPACE CONTEXT:
${contextText}

CHAT HISTORY:
${history}

TASK:
Respond to the latest user request using the context above.`;
};

type CodexExecInput = {
  runId: string;
  userId: string | number;
  userName?: string;
  chatId?: string;
  messages: Array<{ role: string; content: string }>;
  contextText: string;
  systemPrompt: string;
  model?: string;
  onLine?: (line: string) => void;
};

const executeCodexCli = async (input: CodexExecInput) => {
  const outputFile = path.join(tmpdir(), `idp-codex-last-${input.runId}.txt`);
  const prompt = buildCodexPrompt(
    input.messages,
    input.contextText,
    input.systemPrompt
  );
  const runOnce = async (model?: string) =>
    new Promise<{
      stdoutText: string;
      stderrText: string;
      exitCode: number;
    }>((resolve, reject) => {
      const args = [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '-C',
        resolveCodexCwd(),
        '--output-last-message',
        outputFile,
      ];
      if (model) {
        args.push('-m', model);
      }
      args.push('-');
      const child = spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const timeoutMs = resolveCodexTimeoutMs();
      let stdoutText = '';
      let stderrText = '';
      let lineBuffer = '';
      let stderrLineBuffer = '';
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        input.onLine?.(`[codex] timed out after ${Math.floor(timeoutMs / 1000)}s`);
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = String(chunk);
        stdoutText += text;
        lineBuffer += text;
        let idx = lineBuffer.indexOf('\n');
        while (idx !== -1) {
          const line = lineBuffer.slice(0, idx).trim();
          lineBuffer = lineBuffer.slice(idx + 1);
          if (line) input.onLine?.(line);
          idx = lineBuffer.indexOf('\n');
        }
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = String(chunk);
        stderrText += text;
        stderrLineBuffer += text;
        let idx = stderrLineBuffer.indexOf('\n');
        while (idx !== -1) {
          const line = stderrLineBuffer.slice(0, idx).trim();
          stderrLineBuffer = stderrLineBuffer.slice(idx + 1);
          if (line) input.onLine?.(`[stderr] ${line}`);
          idx = stderrLineBuffer.indexOf('\n');
        }
      });

      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        const pendingStdout = lineBuffer.trim();
        if (pendingStdout) input.onLine?.(pendingStdout);
        const pendingStderr = stderrLineBuffer.trim();
        if (pendingStderr) input.onLine?.(`[stderr] ${pendingStderr}`);
        resolve({
          stdoutText,
          stderrText,
          exitCode: timedOut ? 124 : typeof code === 'number' ? code : 1,
        });
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });

  const isUnsupportedModelError = (text: string) =>
    /model is not supported when using codex with a chatgpt account/i.test(text) ||
    /unsupported model/i.test(text);

  let result = await runOnce(input.model);
  if (input.model) {
    const detail = `${result.stderrText}\n${result.stdoutText}`;
    if (isUnsupportedModelError(detail)) {
      // Retry once without explicit model so Codex can select an account-compatible default.
      result = await runOnce(undefined);
    }
  }

  const { stdoutText, stderrText, exitCode } = result;
  if (exitCode !== 0) {
    const detail = (stderrText || stdoutText || '').trim();
    throw new Error(detail || `codex exec failed with exit code ${exitCode}`);
  }

  let message = '';
  try {
    message = (await fs.readFile(outputFile, 'utf8')).trim();
  } catch {
    message = '';
  } finally {
    await fs.unlink(outputFile).catch(() => undefined);
  }

  if (!message) {
    message = stdoutText.trim();
  }
  if (!message) {
    message = 'Codex completed with no response text.';
  }
  return { message };
};

const executeCodexGateway = async (input: CodexExecInput) => {
  const runtime = await resolveCodexGatewayBaseForUser(input.userId, input.userName);
  const baseUrl = runtime.baseUrl;
  if (!baseUrl) {
    throw new Error('AGENT_CODEX_GATEWAY_URL is not configured');
  }
  const gatewayMode = resolveCodexGatewayModeValue();
  const gatewayCwd = gatewayMode === 'container' ? '/workspace' : resolveCodexCwd();

  const response = await fetch(`${baseUrl}/v1/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: String(input.userId),
      chatId: input.chatId || 'default',
      prompt: getLatestUserPrompt(input.messages),
      fullPrompt: buildCodexPrompt(
        input.messages,
        input.contextText,
        input.systemPrompt
      ),
      model: input.model,
      stream: true,
      cwd: gatewayCwd,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim();
    throw new Error(detail || `codex-gateway request failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('codex-gateway returned no stream body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  let doneMessage = '';
  let doneError = '';
  let doneOk = false;
  let doneSignal = '';

  const processBlock = (block: string) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return;

    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    if (!dataLines.length) return;

    const rawData = dataLines.join('\n');
    let payload: any;
    try {
      payload = JSON.parse(rawData);
    } catch {
      input.onLine?.(`[gateway] ${rawData}`);
      return;
    }

    if (eventName === 'status') {
      input.onLine?.(`[gateway] ${String(payload?.state || 'status')}`);
      return;
    }
    if (eventName === 'stdout') {
      const line = String(payload?.line || '').trim();
      if (line) input.onLine?.(line);
      return;
    }
    if (eventName === 'stderr') {
      const line = String(payload?.line || '').trim();
      if (line) input.onLine?.(`[stderr] ${line}`);
      return;
    }
    if (eventName === 'done') {
      done = true;
      doneOk = Boolean(payload?.ok);
      doneMessage = String(payload?.message || '').trim();
      doneError = String(payload?.error || '').trim();
      doneSignal = String(payload?.signal || '').trim();
    }
  };

  const reader = response.body.getReader();
  while (true) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;
    if (!value) continue;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processBlock(block);
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) processBlock(buffer.trim());

  if (!done) {
    throw new Error('codex-gateway stream ended without done event');
  }
  if (!doneOk) {
    if (doneSignal) {
      throw new Error(
        doneError || `codex-gateway terminated codex process (${doneSignal})`
      );
    }
    throw new Error(doneError || 'codex-gateway execution failed');
  }

  return {
    message: doneMessage || 'Codex completed with no response text.',
  };
};

const executeCodex = async (input: CodexExecInput) => {
  const mode = resolveCodexGatewayModeValue();
  const gatewayEnabled = mode !== 'off' && mode !== 'none' && mode !== 'disabled';
  const shouldUseGateway =
    gatewayEnabled && (mode === 'container' || Boolean(resolveCodexGatewayUrl()));
  if (shouldUseGateway) {
    return executeCodexGateway(input);
  }
  return executeCodexCli(input);
};

type CodexOperation = {
  tool?: string;
  name?: string;
  action?: string;
  toolId?: string;
  args?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  input?: Record<string, unknown>;
  reason?: string;
};

type CodexPlan = {
  summary?: string;
  operations?: CodexOperation[];
};

type FileDirective = {
  path: string;
  action: 'create' | 'edit' | 'delete';
  content?: string;
};

const CODEX_MUTATION_TOOLS = new Set([
  'create_module',
  'update_module',
  'delete_module',
  'create_model',
  'update_model',
  'delete_model',
  'create_ui_package',
  'update_ui_package',
  'delete_ui_package',
  'create_shared_ui_project',
  'create_shared_module_project',
  'update_acl_file',
  'write_shared_file',
  'delete_shared_file',
  'create_file',
  'update_file',
  'delete_file',
]);

const parseJsonObject = (candidate: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // no-op
  }
  return null;
};

const parseCodexPlan = (raw: string): CodexPlan | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const fenceMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fenceMatches) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate);
    if (!parsed) continue;
    const summary =
      typeof parsed.summary === 'string'
        ? parsed.summary
        : typeof parsed.message === 'string'
          ? parsed.message
          : undefined;
    const operationsRaw = Array.isArray(parsed.operations)
      ? parsed.operations
      : Array.isArray(parsed.actions)
        ? parsed.actions
        : Array.isArray(parsed.steps)
          ? parsed.steps
          : parsed.tool && typeof parsed.tool === 'string'
            ? [parsed]
            : [];
    const operations = operationsRaw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const rawTool =
          (item as any).tool ??
          (item as any).name ??
          (item as any).action ??
          (item as any).toolId;
        const tool = typeof rawTool === 'string' ? rawTool.trim() : '';
        if (!tool) return null;
        const input =
          ((item as any).input && typeof (item as any).input === 'object' && !Array.isArray((item as any).input)
            ? ((item as any).input as Record<string, unknown>)
            : (item as any).args && typeof (item as any).args === 'object' && !Array.isArray((item as any).args)
              ? ((item as any).args as Record<string, unknown>)
              : (item as any).parameters &&
                  typeof (item as any).parameters === 'object' &&
                  !Array.isArray((item as any).parameters)
                ? ((item as any).parameters as Record<string, unknown>)
                : {}) as Record<string, unknown>;
        const reason = typeof (item as any).reason === 'string' ? (item as any).reason : undefined;
        return { tool, input, reason } as CodexOperation;
      })
      .filter(Boolean) as CodexOperation[];
    return { summary, operations };
  }
  return null;
};

const parseDirectiveAction = (value: unknown): FileDirective['action'] | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'create' || normalized === 'edit' || normalized === 'delete') return normalized;
  if (normalized === 'update') return 'edit';
  if (normalized === 'remove') return 'delete';
  return null;
};

const parseCodexFileDirectives = (raw: string): FileDirective[] => {
  const directives: FileDirective[] = [];
  const trimmed = raw.trim();
  if (!trimmed) return directives;

  const parsedRoot = parseJsonObject(trimmed);
  if (parsedRoot) {
    const candidates = ['files', 'changes', 'edits']
      .map((key) => (parsedRoot as Record<string, unknown>)[key])
      .find((value) => Array.isArray(value));
    if (Array.isArray(candidates)) {
      for (const item of candidates) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const obj = item as Record<string, unknown>;
        const path = typeof obj.path === 'string' ? obj.path.trim() : '';
        const action = parseDirectiveAction(obj.action);
        if (!path || !action) continue;
        directives.push({
          path,
          action,
          content: typeof obj.content === 'string' ? obj.content : undefined,
        });
      }
    }
  }

  const fileBlockRegex =
    /###\s*FILE:\s*(.+?)\r?\n###\s*ACTION:\s*(CREATE|EDIT|UPDATE|DELETE|REMOVE)\s*\r?\n```[\w-]*\r?\n([\s\S]*?)```/gim;
  let match: RegExpExecArray | null;
  while ((match = fileBlockRegex.exec(raw)) !== null) {
    const path = String(match[1] || '').trim();
    const action = parseDirectiveAction(match[2]);
    if (!path || !action) continue;
    directives.push({
      path,
      action,
      content: match[3] ?? '',
    });
  }

  return directives;
};

const pickString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
};

const getNested = (obj: Record<string, unknown>, path: string[]): unknown => {
  let cursor: unknown = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
};

const formatCodexProgressLine = (
  line: string
): { text: string; appendNewline: boolean } | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const looksLikeSuppressedReasoning = (value: string) => {
    const lower = value.toLowerCase();
    if (
      lower.includes('preparing json response') ||
      lower.includes('creating a json-only reply')
    ) {
      return true;
    }
    if (
      value.startsWith('{') &&
      value.endsWith('}') &&
      value.includes('"summary"') &&
      value.includes('"operations"')
    ) {
      return true;
    }
    return false;
  };

  if (looksLikeSuppressedReasoning(trimmed)) return null;

  const parsed = parseJsonObject(trimmed);
  if (!parsed) {
    // Keep only explicit error lines from the underlying process.
    if (trimmed.startsWith('[stderr]')) {
      return { text: trimmed, appendNewline: true };
    }
    return null;
  }

  const type = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  const itemType = String(getNested(parsed, ['item', 'type']) ?? '').trim();
  const itemText = pickString(getNested(parsed, ['item', 'text']));
  if (type === 'item.completed' || type === 'item.started') {
    if (itemText) {
      if (itemType === 'reasoning') {
        return null;
      }
      if (itemType === 'agent_message') {
        if (looksLikeSuppressedReasoning(itemText.trim())) return null;
        return null;
      }
      return { text: `[codex:${itemType || 'item'}] ${itemText.trim()}`, appendNewline: true };
    }
    if (itemType) {
      const verb = type === 'item.started' ? 'started' : 'completed';
      if (itemType === 'reasoning' || itemType === 'agent_message') return null;
      return { text: `[codex] ${itemType} ${verb}`, appendNewline: true };
    }
  }

  if (type === 'turn.completed') {
    const inTokens = getNested(parsed, ['usage', 'input_tokens']);
    const outTokens = getNested(parsed, ['usage', 'output_tokens']);
    const cachedTokens = getNested(parsed, ['usage', 'cached_input_tokens']);
    const usageParts: string[] = [];
    if (typeof inTokens === 'number') usageParts.push(`in:${inTokens}`);
    if (typeof outTokens === 'number') usageParts.push(`out:${outTokens}`);
    if (typeof cachedTokens === 'number') usageParts.push(`cached:${cachedTokens}`);
    return {
      text: usageParts.length ? `[codex] turn completed (${usageParts.join(' ')})` : '[codex] turn completed',
      appendNewline: true,
    };
  }

  const event = typeof parsed.event === 'string' ? parsed.event.trim() : '';
  const status = typeof parsed.status === 'string' ? parsed.status.trim() : '';
  const label = [type, event, status]
    .filter(Boolean)
    .join(' ')
    .replace(/^thread\.started$/i, 'thread started')
    .replace(/^turn\.started$/i, 'turn started');
  if (label === 'thread started' || label === 'turn started') return null;
  if (label) return { text: `[codex] ${label}`, appendNewline: true };

  if (typeof parsed.error === 'string' && parsed.error.trim()) {
    return { text: `[stderr] ${parsed.error.trim()}`, appendNewline: true };
  }
  return null;
};

const CODEX_TOOL_ALIASES: Record<string, string> = {
  'create-module': 'create_module',
  createModule: 'create_module',
  'update-module': 'update_module',
  updateModule: 'update_module',
  'delete-module': 'delete_module',
  deleteModule: 'delete_module',
  'create-model': 'create_model',
  createModel: 'create_model',
  'update-model': 'update_model',
  updateModel: 'update_model',
  'delete-model': 'delete_model',
  deleteModel: 'delete_model',
  'create-ui-package': 'create_ui_package',
  createUiPackage: 'create_ui_package',
  'update-ui-package': 'update_ui_package',
  updateUiPackage: 'update_ui_package',
  'delete-ui-package': 'delete_ui_package',
  deleteUiPackage: 'delete_ui_package',
  'update-acl-file': 'update_acl_file',
  updateAclFile: 'update_acl_file',
  'write-shared-file': 'write_shared_file',
  writeSharedFile: 'write_shared_file',
  'delete-shared-file': 'delete_shared_file',
  deleteSharedFile: 'delete_shared_file',
  'get-shared-file': 'get_shared_file',
  getSharedFile: 'get_shared_file',
  'get-module': 'get_module',
  getModule: 'get_module',
  'get-model': 'get_model',
  getModel: 'get_model',
  'get-ui-package': 'get_ui_package',
  getUiPackage: 'get_ui_package',
  'create-shared-ui-project': 'create_shared_ui_project',
  createSharedUiProject: 'create_shared_ui_project',
  'create-shared-module-project': 'create_shared_module_project',
  createSharedModuleProject: 'create_shared_module_project',
  'create-file': 'create_file',
  createFile: 'create_file',
  'update-file': 'update_file',
  updateFile: 'update_file',
  'delete-file': 'delete_file',
  deleteFile: 'delete_file',
  'edit-file': 'update_file',
  editFile: 'update_file',
  'write-file': 'update_file',
  writeFile: 'update_file',
  'save-file': 'update_file',
  saveFile: 'update_file',
  'editor-create-file': 'create_file',
  editorCreateFile: 'create_file',
  'editor-update-file': 'update_file',
  editorUpdateFile: 'update_file',
  'editor-delete-file': 'delete_file',
  editorDeleteFile: 'delete_file',
};

const toToolId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const direct = CODEX_TOOL_ALIASES[trimmed];
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  if (CODEX_TOOL_ALIASES[lower]) return CODEX_TOOL_ALIASES[lower];
  return lower;
};

const pickInput = (input: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (input[key] !== undefined) return input[key];
  }
  return undefined;
};

const putIfDefined = (target: Record<string, unknown>, key: string, value: unknown) => {
  if (value === undefined || value === null) return;
  target[key] = value;
};

const normalizeModelPathInput = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) return trimmed;
  const withPrefix = trimmed.includes('/') ? trimmed : `models/${trimmed}`;
  const hasExt = /\.[a-zA-Z0-9]+$/.test(withPrefix);
  return hasExt ? withPrefix : `${withPrefix}.js`;
};

const normalizeProjectKind = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ui' || normalized === 'shared-ui' || normalized === 'shared_ui') return 'ui';
  if (
    normalized === 'module' ||
    normalized === 'modules' ||
    normalized === 'shared-module' ||
    normalized === 'shared_module' ||
    normalized === 'backend'
  )
    return 'module';
  return value;
};

const parseModuleLookupFromPath = (value: unknown) => {
  if (typeof value !== 'string') return {};
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const trimmed = normalized.toLowerCase().startsWith('modules/')
    ? normalized.slice('modules/'.length)
    : normalized;
  const match = trimmed.match(
    /^(.*)\/(get|post|put|patch|delete|head|options)\.module\.[a-z0-9]+$/i
  );
  if (!match) return {};
  const routePart = match[1] || '';
  return {
    routePath: routePart ? `/${routePart}` : '/',
    method: String(match[2] || '').toUpperCase(),
  };
};

const HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const normalizeHttpMethod = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const method = value.trim().toUpperCase();
  if (!method) return undefined;
  return HTTP_METHODS.has(method) ? method : undefined;
};

const inferMethodFromModuleCode = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const code = value;
  const patterns = [
    /req\.method\s*!==\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/gi,
    /req\.method\s*===\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]/gi,
    /case\s*["'`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'`]\s*:/gi,
  ];
  const hits: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(code)) !== null) {
      const method = String(match[1] || '').toUpperCase();
      if (HTTP_METHODS.has(method) && !hits.includes(method)) {
        hits.push(method);
      }
    }
  }
  if (hits.length === 1) return hits[0];
  if (!hits.length) return undefined;
  // Prefer typical write methods when multiple guards exist, otherwise first.
  for (const preferred of ['POST', 'PATCH', 'PUT', 'DELETE', 'GET']) {
    if (hits.includes(preferred)) return preferred;
  }
  return hits[0];
};

const parseUiLookupFromValue = (value: unknown) => {
  if (typeof value !== 'string') return {};
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const raw = normalized.toLowerCase().startsWith('ui/')
    ? normalized.slice('ui/'.length)
    : normalized;

  const uiFileMatch = raw.match(/^(.*)\.ui\.[^.\/]+$/i);
  if (uiFileMatch?.[1]) {
    return { name: uiFileMatch[1] };
  }

  const at = raw.lastIndexOf('@');
  if (at > 0 && at + 1 < raw.length && /\d/.test(raw[at + 1] ?? '')) {
    return {
      name: raw.slice(0, at),
      version: raw.slice(at + 1),
    };
  }

  const segments = raw.split('/').filter(Boolean);
  if (segments.length >= 2 && /^index\.[a-z0-9]+$/i.test(segments[segments.length - 1] || '')) {
    return { name: segments.slice(0, -1).join('/') };
  }

  if (segments.length >= 2) {
    const last = segments[segments.length - 1] || '';
    const extMatch = last.match(/^(.+)\.([a-z0-9]+)$/i);
    if (extMatch?.[1]) {
      const base = extMatch[1];
      const ext = extMatch[2]?.toLowerCase();
      if (ext && ['jsx', 'js', 'json', 'css'].includes(ext)) {
        if (base.toLowerCase() === 'index') {
          return { name: segments.slice(0, -1).join('/') };
        }
        return { name: [...segments.slice(0, -1), base].join('/') };
      }
    }
  }

  return {};
};

const inferAclFileFromContent = (content: unknown): 'permissions' | 'roles' | 'endpoints' | null => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const obj = content as Record<string, unknown>;
  if (Array.isArray(obj.permissions)) return 'permissions';
  if (obj.roles !== undefined || obj.groups !== undefined) return 'roles';
  if (obj.endpoints && typeof obj.endpoints === 'object') return 'endpoints';
  const keys = Object.keys(obj);
  if (!keys.length) return null;
  if (keys.some((key) => key.startsWith('/api/'))) return 'endpoints';
  return null;
};

const parseSharedPathInput = (
  rawPath: unknown
): { projectKind?: 'ui' | 'module'; projectName?: string; path?: string } => {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return {};
  const normalized = rawPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const uiMatch = normalized.match(/^shared-ui\/([^/]+)\/(.+)$/i);
  if (uiMatch?.[1] && uiMatch?.[2]) {
    return {
      projectKind: 'ui',
      projectName: uiMatch[1],
      path: uiMatch[2],
    };
  }
  const moduleMatch = normalized.match(/^(shared-modules|shared-backend)\/([^/]+)\/(.+)$/i);
  if (moduleMatch?.[2] && moduleMatch?.[3]) {
    return {
      projectKind: 'module',
      projectName: moduleMatch[2],
      path: moduleMatch[3],
    };
  }
  return { path: normalized };
};

const normalizeOperationInput = (
  toolId: string,
  input: Record<string, unknown>,
  workspace?: WorkspaceContext
) => {
  const next: Record<string, unknown> = {};
  const modules = workspace?.modules ?? [];
  const uiPackages = workspace?.uiPackages ?? [];
  const sharedUiProjects = workspace?.sharedUi ?? [];
  const sharedModuleProjects = workspace?.sharedModules ?? [];

  const findUiByName = (name: string) =>
    uiPackages.find((pkg) => pkg.name === name) || null;
  const findUiById = (id: string) => uiPackages.find((pkg) => pkg.id === id) || null;
  const findModuleByRoute = (routePath: string, method?: string) =>
    modules.find(
      (mod) =>
        mod.routePath === routePath &&
        (!method || mod.method.toUpperCase() === method.toUpperCase())
    ) || null;
  const resolveSharedProjectId = (kind: 'ui' | 'module', projectName: string) => {
    const list = kind === 'ui' ? sharedUiProjects : sharedModuleProjects;
    return list.find((project) => project.name === projectName)?.id;
  };

  if (toolId === 'create_module' || toolId === 'update_module' || toolId === 'delete_module') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'moduleId', 'module_id']));
    const rawRoutePath = pickInput(input, ['routePath', 'route', 'path', 'route_path', 'endpoint']);
    const parsedFromPath = parseModuleLookupFromPath(rawRoutePath);
    const rawCode = pickInput(input, ['code', 'content', 'source', 'body']);
    putIfDefined(
      next,
      'routePath',
      parsedFromPath.routePath ??
        (typeof rawRoutePath === 'string' ? rawRoutePath : undefined)
    );
    const method = pickInput(input, ['method', 'httpMethod', 'http_method', 'verb']);
    const normalizedMethod =
      normalizeHttpMethod(method) ??
      normalizeHttpMethod(parsedFromPath.method) ??
      inferMethodFromModuleCode(rawCode) ??
      (toolId === 'create_module' ? 'GET' : undefined);
    putIfDefined(next, 'method', normalizedMethod);
    if (!next.id && typeof next.routePath === 'string') {
      const resolved = findModuleByRoute(String(next.routePath), String(next.method || ''));
      if (resolved) {
        next.id = resolved.id;
        if (!next.method) next.method = resolved.method;
      }
    }
    putIfDefined(next, 'code', rawCode);
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    return next;
  }

  if (toolId === 'create_model' || toolId === 'update_model' || toolId === 'delete_model') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'modelId', 'model_id']));
    putIfDefined(next, 'path', normalizeModelPathInput(pickInput(input, ['path', 'modelPath', 'filePath', 'file', 'name'])));
    putIfDefined(next, 'newPath', normalizeModelPathInput(pickInput(input, ['newPath', 'new_path', 'targetPath', 'toPath'])));
    putIfDefined(next, 'code', pickInput(input, ['code', 'content', 'source', 'body']));
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    return next;
  }

  if (
    toolId === 'create_ui_package' ||
    toolId === 'update_ui_package' ||
    toolId === 'delete_ui_package' ||
    toolId === 'get_ui_package'
  ) {
    putIfDefined(next, 'id', pickInput(input, ['id', 'uiId', 'packageId', 'package_id']));
    const rawName = pickInput(input, ['name', 'package', 'packageName', 'uiName', 'path', 'filePath', 'file']);
    const rawPath = pickInput(input, ['path', 'filePath', 'file', 'virtualPath']);
    const parsedFromPath = parseUiLookupFromValue(rawPath ?? rawName);
    const name =
      (typeof rawName === 'string' && rawName.trim() ? rawName : undefined) ??
      parsedFromPath.name;
    putIfDefined(next, 'name', name);
    const rawVersion = pickInput(input, ['version', 'packageVersion', 'pkgVersion']);
    const version =
      (typeof rawVersion === 'string' && rawVersion.trim() ? rawVersion : undefined) ??
      parsedFromPath.version;
    putIfDefined(next, 'version', version);
    if (!next.id && typeof next.name === 'string') {
      const resolved = findUiByName(next.name);
      if (resolved) {
        next.id = resolved.id;
        if (!next.version) next.version = resolved.version;
      }
    } else if (typeof next.id === 'string' && !next.version) {
      const resolved = findUiById(next.id);
      if (resolved) {
        next.version = resolved.version;
        next.name = next.name || resolved.name;
      }
    }
    const rawCode = pickInput(input, ['code', 'content', 'source', 'body']);
    if (typeof rawCode === 'string') {
      next.code = rawCode;
    } else if (toolId === 'create_ui_package') {
      next.code = DEFAULT_UI_CODE;
    }
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    putIfDefined(next, 'dependencies', pickInput(input, ['dependencies', 'deps']));
    if (toolId === 'create_ui_package' && typeof next.version !== 'string') {
      next.version = DEFAULT_UI_VERSION;
    }
    if (toolId === 'update_ui_package' && !next.id && typeof next.name === 'string') {
      const resolved = findUiByName(next.name);
      if (resolved) {
        next.id = resolved.id;
        next.version = resolved.version;
      } else if (typeof next.version !== 'string') {
        next.version = DEFAULT_UI_VERSION;
      }
    }
    return next;
  }

  if (toolId === 'create_shared_ui_project' || toolId === 'create_shared_module_project') {
    putIfDefined(next, 'name', pickInput(input, ['name', 'projectName', 'project', 'packageName']));
    putIfDefined(next, 'version', pickInput(input, ['version', 'projectVersion', 'pkgVersion']));
    putIfDefined(next, 'entryPath', pickInput(input, ['entryPath', 'entry', 'path']));
    putIfDefined(next, 'code', pickInput(input, ['code', 'content', 'source', 'body']));
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    putIfDefined(next, 'dependencies', pickInput(input, ['dependencies', 'deps']));
    return next;
  }

  if (toolId === 'update_acl_file') {
    const rawFile = pickInput(input, ['file', 'name', 'target', 'aclFile']);
    const content = pickInput(input, ['content', 'value', 'data', 'json']);
    const inferredFile =
      (typeof rawFile === 'string' ? rawFile.trim().toLowerCase() : '') ||
      inferAclFileFromContent(content) ||
      inferAclFileFromContent(input);
    if (inferredFile === 'permissions' || inferredFile === 'roles' || inferredFile === 'endpoints') {
      next.file = inferredFile;
    }
    if (content !== undefined) {
      next.content = content;
    } else if (inferredFile && typeof input === 'object' && input) {
      if (inferredFile === 'permissions' && (input as any).permissions !== undefined) {
        next.content = { permissions: (input as any).permissions };
      } else if (inferredFile === 'roles' && ((input as any).roles !== undefined || (input as any).groups !== undefined)) {
        next.content = {
          roles: (input as any).roles ?? {},
          groups: (input as any).groups ?? {},
        };
      } else if (inferredFile === 'endpoints') {
        const obj = input as Record<string, unknown>;
        next.content = obj.endpoints && typeof obj.endpoints === 'object' ? obj.endpoints : obj;
      }
    }
    return next;
  }

  if (toolId === 'write_shared_file' || toolId === 'delete_shared_file' || toolId === 'get_shared_file') {
    putIfDefined(next, 'projectId', pickInput(input, ['projectId', 'project_id', 'sharedProjectId']));
    putIfDefined(next, 'fileId', pickInput(input, ['fileId', 'file_id']));
    const rawPath = pickInput(input, ['path', 'filePath', 'file']);
    const parsedSharedPath = parseSharedPathInput(rawPath);
    putIfDefined(next, 'path', parsedSharedPath.path);
    putIfDefined(next, 'content', pickInput(input, ['content', 'code', 'source', 'body']));
    putIfDefined(next, 'fileExtension', pickInput(input, ['fileExtension', 'extension', 'ext']));
    const projectKind =
      normalizeProjectKind(pickInput(input, ['projectKind', 'kind', 'type'])) ??
      parsedSharedPath.projectKind;
    putIfDefined(next, 'projectKind', projectKind);
    const explicitProjectName = pickInput(input, ['projectName', 'project', 'name']);
    const projectName =
      (typeof explicitProjectName === 'string' ? explicitProjectName : undefined) ??
      parsedSharedPath.projectName;
    putIfDefined(next, 'projectName', projectName);
    putIfDefined(next, 'projectVersion', pickInput(input, ['projectVersion', 'version', 'pkgVersion']));
    putIfDefined(next, 'dependencies', pickInput(input, ['dependencies', 'deps']));
    if (!next.projectId) {
      if (typeof projectName === 'string' && typeof projectKind === 'string') {
        const resolved = resolveSharedProjectId(projectKind as 'ui' | 'module', projectName);
        if (resolved) next.projectId = resolved;
      }
    }
    return next;
  }

  if (toolId === 'get_module') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'moduleId', 'module_id']));
    const rawPath = pickInput(input, ['routePath', 'route', 'path', 'filePath', 'file', 'virtualPath']);
    const parsedFromPath = parseModuleLookupFromPath(rawPath);
    putIfDefined(
      next,
      'routePath',
      parsedFromPath.routePath ??
        (typeof rawPath === 'string' ? rawPath : undefined)
    );
    const method = pickInput(input, ['method', 'httpMethod', 'verb']);
    const normalizedMethod =
      typeof method === 'string' && method.trim()
        ? method.toUpperCase()
        : parsedFromPath.method;
    putIfDefined(next, 'method', normalizedMethod);
    if (!next.id && typeof next.routePath === 'string') {
      const resolved = findModuleByRoute(String(next.routePath), typeof next.method === 'string' ? next.method : undefined);
      if (resolved) {
        next.id = resolved.id;
        next.method = resolved.method;
      }
    }
    return next;
  }

  if (toolId === 'get_model') {
    putIfDefined(next, 'id', pickInput(input, ['id', 'modelId', 'model_id']));
    putIfDefined(next, 'path', normalizeModelPathInput(pickInput(input, ['path', 'modelPath', 'filePath', 'file'])));
    return next;
  }

  return input;
};

const normalizePath = (value: string) =>
  value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

const stripPathSegment = (pathValue: string, segment: string) => {
  const normalized = normalizePath(pathValue);
  if (normalized.toLowerCase().startsWith(`${segment.toLowerCase()}/`)) {
    return normalized.slice(segment.length + 1);
  }
  return normalized;
};

const asJsonObject = (value: string) => {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return null;
  }
  return null;
};

const buildOperationsFromDirectives = (
  directives: FileDirective[],
  workspace: WorkspaceContext
): CodexOperation[] => {
  const operations: CodexOperation[] = [];
  const modulesByKey = new Map(
    (workspace.modules ?? []).map((mod) => [
      `${mod.method.toUpperCase()}::${mod.routePath}`,
      mod,
    ])
  );
  const latestUiByName = new Map<string, WorkspaceContext['uiPackages'][number]>();
  for (const pkg of workspace.uiPackages ?? []) {
    if (!latestUiByName.has(pkg.name)) latestUiByName.set(pkg.name, pkg);
  }
  const sharedUiByName = new Map((workspace.sharedUi ?? []).map((pkg) => [pkg.name, pkg]));
  const sharedModulesByName = new Map(
    (workspace.sharedModules ?? []).map((pkg) => [pkg.name, pkg])
  );
  const plannedSharedUiCreates = new Set<string>();
  const plannedSharedModuleCreates = new Set<string>();

  for (const directive of directives) {
    const pathValue = normalizePath(directive.path);
    const lower = pathValue.toLowerCase();
    const content = directive.content ?? '';

    if (lower.startsWith('modules/acl/')) {
      const fileMatch = pathValue.match(/^modules\/acl\/(permissions|roles|endpoints)\.json$/i);
      if (!fileMatch || directive.action === 'delete') continue;
      operations.push({
        tool: 'update_acl_file',
        input: {
          file: fileMatch[1].toLowerCase(),
          content: asJsonObject(content) ?? {},
        },
      });
      continue;
    }

    if (lower.startsWith('modules/')) {
      const relative = stripPathSegment(pathValue, 'modules');
      const moduleMatch = relative.match(/^(.*)\/(get|post|put|patch|delete|head|options)\.module\.([a-z0-9]+)$/i);
      if (!moduleMatch) continue;
      const routePart = moduleMatch[1] || '';
      const routePath = routePart ? `/${routePart}` : '/';
      const method = moduleMatch[2].toUpperCase();
      const ext = moduleMatch[3].toLowerCase();
      const existing = modulesByKey.get(`${method}::${routePath}`);
      if (directive.action === 'delete') {
        operations.push({
          tool: 'delete_module',
          input: existing
            ? { id: existing.id }
            : { routePath, method },
        });
        continue;
      }
      operations.push({
        tool: existing || directive.action === 'edit' ? 'update_module' : 'create_module',
        input: existing
          ? { id: existing.id, code: content, fileExtension: ext }
          : { routePath, method, code: content, fileExtension: ext },
      });
      continue;
    }

    if (lower.startsWith('models/')) {
      const rel = stripPathSegment(pathValue, 'models');
      const modelPath = normalizeModelPathInput(`models/${rel}`);
      const extMatch = String(modelPath).match(/\.([a-z0-9]+)$/i);
      const ext = extMatch?.[1]?.toLowerCase() || 'js';
      if (directive.action === 'delete') {
        operations.push({ tool: 'delete_model', input: { path: modelPath } });
      } else if (directive.action === 'edit') {
        operations.push({
          tool: 'update_model',
          input: { path: modelPath, code: content, fileExtension: ext },
        });
      } else {
        operations.push({
          tool: 'create_model',
          input: { path: modelPath, code: content, fileExtension: ext },
        });
      }
      continue;
    }

    if (lower.startsWith('ui/')) {
      const rel = stripPathSegment(pathValue, 'ui');
      const uiMatch = rel.match(/^(.*)\.ui\.([a-z0-9]+)$/i);
      let name = '';
      let ext = '';
      if (uiMatch) {
        name = uiMatch[1];
        ext = uiMatch[2].toLowerCase();
      } else {
        const generic = rel.match(/^(.*)\/([^/.]+)\.([a-z0-9]+)$/i);
        if (!generic) continue;
        ext = generic[3].toLowerCase();
        if (!['jsx', 'js', 'json', 'css'].includes(ext)) continue;
        name =
          generic[2].toLowerCase() === 'index'
            ? generic[1]
            : `${generic[1]}/${generic[2]}`;
      }
      if (!name) continue;
      const existing = latestUiByName.get(name);
      if (directive.action === 'delete') {
        operations.push({
          tool: 'delete_ui_package',
          input: existing
            ? { id: existing.id }
            : { name, version: '1.0.0' },
        });
        continue;
      }
      if (existing) {
        operations.push({
          tool: 'update_ui_package',
          input: { id: existing.id, code: content, fileExtension: ext },
        });
      } else {
        operations.push({
          tool: 'create_ui_package',
          input: { name, version: '1.0.0', code: content, fileExtension: ext },
        });
      }
      continue;
    }

    if (lower.startsWith('shared-ui/')) {
      const rel = stripPathSegment(pathValue, 'shared-ui');
      const parts = rel.split('/');
      const projectName = parts.shift() || '';
      if (!projectName) continue;
      const project = sharedUiByName.get(projectName);
      const filePath = parts.join('/');
      if (!filePath) continue;
      if (!project) {
        if (directive.action === 'delete') continue;
        if (!plannedSharedUiCreates.has(projectName)) {
          operations.push({
            tool: 'create_shared_ui_project',
            input: {
              name: projectName,
              version: '1.0.0',
              entryPath: filePath,
              code: content || DEFAULT_UI_CODE,
              fileExtension: filePath.split('.').pop()?.toLowerCase() || 'jsx',
              dependencies: [],
            },
          });
          plannedSharedUiCreates.add(projectName);
        }
        operations.push({
          tool: 'write_shared_file',
          input: {
            projectName,
            projectVersion: '1.0.0',
            projectKind: 'ui',
            path: filePath,
            content,
          },
        });
        continue;
      }
      operations.push({
        tool: directive.action === 'delete' ? 'delete_shared_file' : 'write_shared_file',
        input:
          directive.action === 'delete'
            ? { projectId: project.id, projectKind: 'ui', path: filePath }
            : {
                projectId: project.id,
                projectKind: 'ui',
                path: filePath,
                content,
              },
      });
      continue;
    }

    if (lower.startsWith('shared-modules/') || lower.startsWith('shared-backend/')) {
      const rel = lower.startsWith('shared-modules/')
        ? stripPathSegment(pathValue, 'shared-modules')
        : stripPathSegment(pathValue, 'shared-backend');
      const parts = rel.split('/');
      const projectName = parts.shift() || '';
      if (!projectName) continue;
      const project = sharedModulesByName.get(projectName);
      const filePath = parts.join('/');
      if (!filePath) continue;
      if (!project) {
        if (directive.action === 'delete') continue;
        if (!plannedSharedModuleCreates.has(projectName)) {
          operations.push({
            tool: 'create_shared_module_project',
            input: {
              name: projectName,
              version: '1.0.0',
              entryPath: filePath,
              code: content || 'module.exports = {};\n',
              fileExtension: filePath.split('.').pop()?.toLowerCase() || 'js',
              dependencies: [],
            },
          });
          plannedSharedModuleCreates.add(projectName);
        }
        operations.push({
          tool: 'write_shared_file',
          input: {
            projectName,
            projectVersion: '1.0.0',
            projectKind: 'module',
            path: filePath,
            content,
          },
        });
        continue;
      }
      operations.push({
        tool: directive.action === 'delete' ? 'delete_shared_file' : 'write_shared_file',
        input:
          directive.action === 'delete'
            ? { projectId: project.id, projectKind: 'module', path: filePath }
            : {
                projectId: project.id,
                projectKind: 'module',
                path: filePath,
                content,
              },
      });
    }
  }

  return operations;
};

const executeCodexOperations = async (
  tools: Record<string, any>,
  operations: CodexOperation[],
  workspace: WorkspaceContext,
  getChanges: () => AssistantChange[],
  onChange?: (change: AssistantChange) => void,
  onProgress?: (line: string) => void
) => {
  const logs: string[] = [];
  const errors: string[] = [];
  let executed = 0;
  let mutationOps = 0;
  let seenChanges = getChanges().length;

  const applySingleOperation = async (
    operation: CodexOperation,
    indexLabel: string
  ) => {
    const toolId = toToolId(
      String(operation.tool || operation.name || operation.action || operation.toolId || '')
    );
    if (!toolId) return;
    const tool = tools[toolId];
    if (!tool?.execute) {
      const message = `Operation ${indexLabel}: unknown tool "${toolId}"`;
      errors.push(message);
      onProgress?.(`${message}\n`);
      return;
    }
    const rawInput =
      operation.input && typeof operation.input === 'object' && !Array.isArray(operation.input)
        ? operation.input
        : {};
    const input = normalizeOperationInput(toolId, rawInput, workspace);
    if (CODEX_MUTATION_TOOLS.has(toolId)) {
      mutationOps += 1;
    }
    onProgress?.(`Applying ${toolId}...\n`);
    try {
      await executeTool(tool, input);
      executed += 1;
      const ok = `Applied ${toolId}`;
      logs.push(ok);
      onProgress?.(`${ok}\n`);
      const current = getChanges();
      if (current.length > seenChanges) {
        const appended = current.slice(seenChanges);
        appended.forEach((change) => onChange?.(change));
        seenChanges = current.length;
      }
    } catch (error) {
      const errorText = String((error as Error).message || error);
      if (toolId === 'create_module' && /module already exists for route\/method/i.test(errorText)) {
        const updateTool = tools.update_module;
        const fallbackInput: Record<string, unknown> = {};
        putIfDefined(fallbackInput, 'id', (input as Record<string, unknown>).id);
        putIfDefined(fallbackInput, 'routePath', (input as Record<string, unknown>).routePath);
        putIfDefined(fallbackInput, 'method', (input as Record<string, unknown>).method);
        putIfDefined(fallbackInput, 'code', (input as Record<string, unknown>).code);
        putIfDefined(
          fallbackInput,
          'fileExtension',
          (input as Record<string, unknown>).fileExtension
        );
        if (updateTool?.execute && (fallbackInput.id || fallbackInput.routePath)) {
          onProgress?.('create_module already exists, retrying as update_module...\n');
          try {
            await executeTool(updateTool, fallbackInput);
            executed += 1;
            const ok = 'Applied update_module (fallback from create_module)';
            logs.push(ok);
            onProgress?.(`${ok}\n`);
            const current = getChanges();
            if (current.length > seenChanges) {
              const appended = current.slice(seenChanges);
              appended.forEach((change) => onChange?.(change));
              seenChanges = current.length;
            }
            return;
          } catch (fallbackError) {
            const fallbackMessage = `Failed update_module fallback: ${String(
              (fallbackError as Error).message || fallbackError
            )}`;
            errors.push(fallbackMessage);
            onProgress?.(`${fallbackMessage}\n`);
          }
        }
      }
      const message = `Failed ${toolId}: ${errorText}`;
      errors.push(message);
      onProgress?.(`${message}\n`);
    }
  };

  for (let index = 0; index < operations.length; index += 1) {
    const op = operations[index];
    const toolId = toToolId(String(op.tool || op.name || op.action || op.toolId || ''));
    if (!toolId) continue;

    if (toolId === 'create_file' || toolId === 'update_file' || toolId === 'delete_file') {
      const rawInput =
        op.input && typeof op.input === 'object' && !Array.isArray(op.input) ? op.input : {};
      const rawPath = pickInput(rawInput, ['path', 'filePath', 'file', 'virtualPath']);
      if (typeof rawPath !== 'string' || !rawPath.trim()) {
        const message = `Failed ${toolId}: path is required`;
        errors.push(message);
        onProgress?.(`${message}\n`);
        continue;
      }
      const directiveAction: FileDirective['action'] =
        toolId === 'create_file' ? 'create' : toolId === 'delete_file' ? 'delete' : 'edit';
      const rawContent = pickInput(rawInput, ['content', 'code', 'source', 'body']);
      const content = typeof rawContent === 'string' ? rawContent : '';
      const mapped = buildOperationsFromDirectives(
        [
          {
            path: rawPath,
            action: directiveAction,
            content,
          },
        ],
        workspace
      );
      if (!mapped.length) {
        const message = `Failed ${toolId}: could not resolve virtual path "${rawPath}"`;
        errors.push(message);
        onProgress?.(`${message}\n`);
        continue;
      }
      onProgress?.(`Resolving ${toolId} => ${mapped.length} operation(s)\n`);
      for (let nestedIndex = 0; nestedIndex < mapped.length; nestedIndex += 1) {
        await applySingleOperation(mapped[nestedIndex], `${index + 1}.${nestedIndex + 1}`);
      }
      continue;
    }

    await applySingleOperation(op, String(index + 1));
  }

  return { executed, mutationOps, logs, errors };
};

const getLatestUserPrompt = (messages: Array<{ role: string; content: string }>) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg.role === 'user') return msg.content || '';
  }
  return '';
};

const promptLooksLikeMutation = (prompt: string) =>
  /\b(create|edit|update|delete|remove|add|implement|fix|refactor|build|redesign|design|change|modify|improve|migrate)\b/i.test(prompt);

const createConflict = (
  message: string,
  severity: CodexConflict['severity'],
  relatedNodeIds: string[]
): CodexConflict => ({
  id:
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `conflict-${Math.random().toString(36).slice(2, 10)}`,
  message,
  severity,
  relatedNodeIds,
});

const buildCodexDagFromEvents = (runId: string, events: AssistantRunEvent[]) => {
  const nodes = events.map((event, index) => ({
    id: `${runId}-node-${index + 1}`,
    label: event.type,
    phase: event.phase,
    status:
      event.type === 'RUN_FAILED'
        ? 'failed'
        : event.type === 'RUN_REQUESTED' ||
          event.type === 'CONTEXT_CAPTURED' ||
          event.type === 'PLAN_READY' ||
          event.type === 'EXECUTION_STARTED' ||
          event.type === 'EXECUTION_COMPLETED' ||
          event.type === 'RUN_COMPLETED'
          ? 'completed'
          : 'running',
    attempt: Number(event.payload?.attempt ?? 0),
  }));
  const edges = nodes
    .map((node, index) => {
      if (index === 0) return null;
      const previous = nodes[index - 1];
      const event = events[index];
      return {
        fromNodeId: previous.id,
        toNodeId: node.id,
        eventType: event.type,
      };
    })
    .filter(Boolean);
  return { nodes, edges } as {
    nodes: Array<{
      id: string;
      label: string;
      phase: AssistantRunEvent['phase'];
      status: 'pending' | 'running' | 'completed' | 'failed';
      attempt: number;
    }>;
    edges: Array<{
      fromNodeId: string;
      toNodeId: string;
      eventType: AssistantRunEvent['type'];
    }>;
  };
};

const buildCoverageState = (
  operations: CodexOperation[],
  changes: AssistantChange[]
): { backend: boolean; models: boolean; ui: boolean; acl: boolean } => {
  const state = { backend: false, models: false, ui: false, acl: false };
  for (const op of operations) {
    const tool = toToolId(String(op.tool || op.name || op.action || op.toolId || ''));
    const opInput =
      op.input && typeof op.input === 'object' && !Array.isArray(op.input)
        ? (op.input as Record<string, unknown>)
        : {};
    if (tool === 'create_module' || tool === 'update_module' || tool === 'delete_module') {
      state.backend = true;
    }
    if (tool === 'create_model' || tool === 'update_model' || tool === 'delete_model') {
      state.models = true;
    }
    if (
      tool === 'create_ui_package' ||
      tool === 'update_ui_package' ||
      tool === 'delete_ui_package' ||
      tool === 'create_shared_ui_project'
    ) {
      state.ui = true;
    }
    if (tool === 'create_shared_module_project') {
      state.backend = true;
    }
    if (tool === 'write_shared_file') {
      const projectKind = normalizeProjectKind(
        opInput?.projectKind
      );
      if (projectKind === 'module') {
        state.backend = true;
      } else {
        state.ui = true;
      }
    }
    if (tool === 'create_file' || tool === 'update_file' || tool === 'delete_file') {
      const rawPath = pickInput(opInput, ['path', 'filePath', 'file', 'virtualPath']);
      const path = typeof rawPath === 'string' ? normalizePath(rawPath) : '';
      const lower = path.toLowerCase();
      if (lower.startsWith('modules/acl/')) {
        state.acl = true;
      } else if (lower.startsWith('modules/')) {
        state.backend = true;
      } else if (lower.startsWith('models/')) {
        state.models = true;
      } else if (lower.startsWith('shared-modules/') || lower.startsWith('shared-backend/')) {
        state.backend = true;
      } else if (lower.startsWith('ui/') || lower.startsWith('shared-ui/')) {
        state.ui = true;
      }
    }
    if (tool === 'update_acl_file') {
      state.acl = true;
    }
  }
  for (const change of changes) {
    if (change.kind === 'module') state.backend = true;
    if (change.kind === 'model') state.models = true;
    if (change.kind === 'ui') state.ui = true;
    if (change.kind === 'shared-file') {
      if (change.projectKind === 'module') state.backend = true;
      else state.ui = true;
    }
    if (change.kind === 'shared-project') {
      if (change.after?.kind === 'module' || change.before?.kind === 'module') {
        state.backend = true;
      } else {
        state.ui = true;
      }
    }
    if (change.kind === 'acl') state.acl = true;
  }
  return state;
};

const buildCoverageConflicts = (
  prompt: string,
  operations: CodexOperation[],
  changes: AssistantChange[],
  opErrors: string[],
  relatedNodeIds: string[]
) => {
  const conflicts: CodexConflict[] = [];
  if (opErrors.length) {
    conflicts.push(
      createConflict(`Operation failures: ${opErrors.join(' | ')}`, 'high', relatedNodeIds)
    );
  }
  const looksLikeMutation = promptLooksLikeMutation(prompt);
  if (!looksLikeMutation) return conflicts;
  if (!changes.length) {
    conflicts.push(
      createConflict('Mutation request produced no applied workspace changes.', 'high', relatedNodeIds)
    );
  }
  const coverage = buildCoverageState(operations, changes);
  if (!coverage.backend) {
    conflicts.push(
      createConflict(
        'Missing backend module updates. Every implementation task must include backend changes.',
        'high',
        relatedNodeIds
      )
    );
  }
  if (!coverage.models) {
    conflicts.push(
      createConflict(
        'Missing ORM model updates. Every implementation task must include model changes.',
        'high',
        relatedNodeIds
      )
    );
  }
  if (!coverage.ui) {
    conflicts.push(
      createConflict(
        'Missing UI package/file updates. Every implementation task must include UI changes.',
        'high',
        relatedNodeIds
      )
    );
  }
  if (!coverage.acl) {
    conflicts.push(
      createConflict(
        'Missing ACL updates. Every implementation task must include ACL changes for endpoint coverage.',
        'high',
        relatedNodeIds
      )
    );
  }
  return conflicts;
};

const buildTargetedRepairPrompt = (prompt: string, conflicts: CodexConflict[]) => {
  const lines = conflicts.map((item) => `- ${item.message}`);
  return `Previous execution has conflicts and must be repaired with targeted operations only.
Recompute the minimal operation set needed to fix these conflicts:
${lines.join('\n')}

Rules:
- Return JSON only with { "summary", "operations" }.
- For implementation requests, include full-stack operations: backend + models + UI + ACL.
- Never use mock/fake/sample/dummy placeholder data.
- Backend ORM calls must be await adapters.orm('<database>:<key>').
- UI networking must use @app/datacontext (no fetch/axios/XMLHttpRequest).
- Provide all required input fields for each tool:
  - create_ui_package: name, version, code
  - update_ui_package: id OR (name + version)
  - update_acl_file: file + content
  - write_shared_file/delete_shared_file/get_shared_file: (projectId OR projectName) + projectKind + path
  - create_shared_ui_project/create_shared_module_project: name + version
  - create_file/update_file/delete_file: path (+ content for create/update)
- UI file directives may be React-app style:
  - ui/@app/dashboard/index.jsx => @app/dashboard
  - ui/@app/dashboard/components/X.jsx => @app/dashboard/components/X
- Do not repeat already successful no-op operations.

Original user request:
${prompt || '(empty)'}`;
};

const codexAskedForUnavailableTools = (message: string) => {
  const text = String(message || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes("tools aren't available") ||
    text.includes('tools are not available') ||
    text.includes('tool isn’t available') ||
    text.includes('tool is not available') ||
    text.includes('list_workspace') ||
    text.includes('get_acl_config') ||
    text.includes('provide their outputs') ||
    text.includes('cannot proceed yet')
  );
};

const buildCodexRecoveryPrompt = (latestPrompt: string) => `Your previous reply asked for unavailable direct tools.
In this environment, tools are executed by the host, and their outputs are already provided in FULL WORKSPACE CONTEXT.
Do NOT ask for list_workspace/get_acl_config again.
Return a valid JSON object with "summary" and "operations" now.
If the latest user request requires workspace mutations, "operations" must be non-empty.
- For implementation requests, include backend + models + UI + ACL in one run.
- Never generate mock/fake/sample/dummy placeholder data.
- Backend ORM usage must be await adapters.orm('<database>:<key>').
- UI networking must use @app/datacontext (no fetch/axios/XMLHttpRequest).
Required tool input fields:
- create_ui_package => name, version, code
- update_ui_package => id OR (name + version)
- update_acl_file => file + content
- write_shared_file/delete_shared_file/get_shared_file => (projectId OR projectName) + projectKind + path
- create_shared_ui_project/create_shared_module_project => name + version
- create_file/update_file/delete_file => path (+ content for create/update)
Latest user request:
${latestPrompt || '(empty)'}`;

const normalizeBaseUrl = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/\/+$/, '');
};

const resolveModelsUrl = (baseUrl: string) => {
  const trimmed = normalizeBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
};

const pickAvailableModel = async (modelConfig: MastraModelConfig): Promise<MastraModelConfig> => {
  if (!modelConfig || typeof modelConfig === 'string') return modelConfig;
  const candidate = modelConfig as {
    providerId: string;
    modelId?: string;
    url?: string;
    apiKey?: string;
  };
  if (candidate.providerId !== 'openai-compatible' || !candidate.url) {
    return modelConfig;
  }

  try {
    const url = resolveModelsUrl(candidate.url);
    if (!url) return modelConfig;
    const response = await fetch(url, {
      headers: candidate.apiKey ? { Authorization: `Bearer ${candidate.apiKey}` } : undefined,
    });
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data?.data)
      ? data.data.map((model: { id?: string }) => model?.id).filter(Boolean)
      : [];
    if (!models.length) return modelConfig;
    if (!candidate.modelId || !models.includes(candidate.modelId)) {
      return {
        providerId: 'openai-compatible',
        modelId: models[0],
        url: candidate.url,
        apiKey: candidate.apiKey,
      };
    }
    return modelConfig;
  } catch {
    return modelConfig;
  }
};

const executeTool = async <T, I>(tool: any, input: I): Promise<T> => {
  if (!tool?.execute) throw new Error('Tool is not available');
  const result = await tool.execute(input, {});
  if (result && typeof result === 'object' && (result as any).error) {
    throw new Error((result as any).message || 'Tool validation failed');
  }
  return result as T;
};

const normalizeContent = (value: unknown) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          return (part as any).text ?? JSON.stringify(part);
        }
        return String(part ?? '');
      })
      .join('');
  }
  return String(value);
};

const normalizeMessages = (raw: unknown) => {
  if (typeof raw === 'string') {
    return [{ role: 'user', content: raw }];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((msg) => {
        if (!msg || typeof msg !== 'object') return null;
        const role = (msg as any).role;
        if (!role || typeof role !== 'string') return null;
        const normalizedRole = role.toLowerCase();
        if (!['user', 'assistant', 'system', 'tool'].includes(normalizedRole)) return null;
        const content = normalizeContent((msg as any).content);
        if (!content) return null;
        return { role: normalizedRole, content };
      })
      .filter(Boolean) as { role: string; content: string }[];
  }
  if (raw && typeof raw === 'object' && (raw as any).role) {
    const role = String((raw as any).role).toLowerCase();
    if (!['user', 'assistant', 'system', 'tool'].includes(role)) {
      return [];
    }
    const content = normalizeContent((raw as any).content);
    if (!content) return [];
    return [{ role, content }];
  }
  return [];
};

const truncate = (value: string, max = MAX_CONTEXT_CHARS) => {
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)`;
};

const normalizeSystemPrompt = (raw: unknown, fallback: string) => {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return truncate(trimmed, MAX_SYSTEM_PROMPT_CHARS);
};

const createRunId = (chatId?: string) => {
  const normalizedChatId = String(chatId || '').trim();
  if (normalizedChatId) {
    const compact = normalizedChatId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
    return `chat-${compact || 'default'}`;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Math.random().toString(36).slice(2, 12)}`;
};

const buildRunName = (messages: Array<{ role: string; content: string }>) => {
  const firstUser = messages.find(
    (message) => message.role === 'user' && message.content.trim()
  );
  const raw = firstUser?.content?.trim() || '';
  if (!raw) return 'Untitled run';
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 80) return singleLine;
  return `${singleLine.slice(0, 77)}...`;
};

const shouldWatchPreviewFromPrompt = (
  messages: Array<{ role: string; content: string }>
) => {
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim());
  const prompt = String(latestUser?.content || '');
  return /\b(watch|monitor|check)\s+preview\b/i.test(prompt);
};

const resolvePreviewExceptionsLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
};

type WorkspaceContext = {
  tenant?: {
    id: string;
    hostname: string;
    adapterAccess?: Record<string, { allow: string[] }>;
    resourceConfig?: { memory?: number; timeout?: number } | null;
    authDbConfig?: { mode?: string; secretKey?: string | null } | null;
  };
  modules: Array<{
    id: string;
    routePath: string;
    method: string;
    code: string;
    fileExtension?: string | null;
  }>;
  models: Array<{
    id: string;
    path: string;
    code: string;
    fileExtension?: string | null;
    draftVersion?: string | null;
  }>;
  uiPackages: Array<{
    id: string;
    name: string;
    version: string;
    code: string;
    dependencies: string[];
    fileExtension?: string | null;
  }>;
  sharedUi: Array<{
    id: string;
    name: string;
    version: string;
    entryPath: string;
    code: string;
    dependencies: string[];
  }>;
  sharedModules: Array<{
    id: string;
    name: string;
    version: string;
    entryPath: string;
    code: string;
    dependencies: string[];
  }>;
  sharedUiFiles?: Array<{
    id: string;
    path: string;
    content: string;
    fileExtension?: string | null;
    projectId: string;
    projectName: string;
  }>;
  sharedModuleFiles?: Array<{
    id: string;
    path: string;
    content: string;
    fileExtension?: string | null;
    projectId: string;
    projectName: string;
  }>;
};

const splitRouteSegments = (routePath: string) => {
  const trimmed = String(routePath || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!trimmed) return [] as string[];
  return trimmed.split('/').filter(Boolean);
};

const splitUiSegments = (name: string) =>
  String(name || '')
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);

const sanitizeForFilename = (value: string) =>
  String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/[\/\\]+/g, '-')
    .replace(/[:*?<>|"]+/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();

const toModuleVirtualPath = (mod: WorkspaceContext['modules'][number]) => {
  const ext = (mod.fileExtension || 'js').replace(/^\./, '').toLowerCase() || 'js';
  const segments = splitRouteSegments(mod.routePath || '/');
  const routeDir = segments.length ? `${segments.join('/')}/` : '';
  return `modules/${routeDir}${String(mod.method || 'GET').toLowerCase()}.module.${ext}`;
};

const toModelVirtualPath = (model: WorkspaceContext['models'][number]) => {
  const rawPath = String(model.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rawPath) {
    const ext = (model.fileExtension || 'js').replace(/^\./, '').toLowerCase() || 'js';
    return `models/${model.id}.${ext}`;
  }
  return rawPath.toLowerCase().startsWith('models/') ? rawPath : `models/${rawPath}`;
};

const toUiVirtualPath = (pkg: WorkspaceContext['uiPackages'][number]) => {
  const ext = (pkg.fileExtension || 'jsx').replace(/^\./, '').toLowerCase() || 'jsx';
  const nameSegments = splitUiSegments(pkg.name || 'ui');
  const folders = nameSegments.slice(0, -1);
  const base = nameSegments[nameSegments.length - 1] || 'ui';
  const fileName = `${sanitizeForFilename(base)}.ui.${ext}`;
  return folders.length ? `ui/${folders.join('/')}/${fileName}` : `ui/${fileName}`;
};

const toSharedVirtualPath = (
  root: 'shared-ui' | 'shared-modules',
  projectName: string,
  filePath: string
) => {
  const name = String(projectName || '').trim();
  const pathPart = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return `${root}/${name}/${pathPart}`;
};

const buildContextText = (
  workspace: WorkspaceContext,
  acl: { permissions: unknown; roles: unknown; endpoints: unknown },
  preview?: { enabled: boolean; exceptions: PreviewExceptionEntry[] },
  actor?: { role: string; permissions: string[] }
) => {
  const lines: string[] = [];
  const sharedUiFiles = workspace.sharedUiFiles ?? [];
  const sharedModuleFiles = workspace.sharedModuleFiles ?? [];
  const workspaceToolView = {
    tenant: workspace.tenant ?? null,
    modules: workspace.modules.map((mod) => ({
      id: mod.id,
      routePath: mod.routePath,
      method: mod.method,
      virtualPath: toModuleVirtualPath(mod),
      fileExtension: mod.fileExtension ?? 'js',
    })),
    models: workspace.models.map((model) => ({
      id: model.id,
      path: model.path,
      virtualPath: toModelVirtualPath(model),
      fileExtension: model.fileExtension ?? 'js',
      draftVersion: model.draftVersion ?? null,
    })),
    uiPackages: workspace.uiPackages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      virtualPath: toUiVirtualPath(pkg),
      dependencies: pkg.dependencies ?? [],
      fileExtension: pkg.fileExtension ?? 'jsx',
    })),
    sharedUi: workspace.sharedUi.map((project) => ({
      id: project.id,
      name: project.name,
      version: project.version,
      entryPath: project.entryPath,
      dependencies: project.dependencies ?? [],
    })),
    sharedModules: workspace.sharedModules.map((project) => ({
      id: project.id,
      name: project.name,
      version: project.version,
      entryPath: project.entryPath,
      dependencies: project.dependencies ?? [],
    })),
    sharedUiFiles: sharedUiFiles.map((file) => ({
      id: file.id,
      projectId: file.projectId,
      projectName: file.projectName,
      path: file.path,
      virtualPath: toSharedVirtualPath('shared-ui', file.projectName, file.path),
      fileExtension: file.fileExtension ?? null,
    })),
    sharedModuleFiles: sharedModuleFiles.map((file) => ({
      id: file.id,
      projectId: file.projectId,
      projectName: file.projectName,
      path: file.path,
      virtualPath: toSharedVirtualPath('shared-modules', file.projectName, file.path),
      fileExtension: file.fileExtension ?? null,
    })),
  };
  const aclToolView = {
    permissions: acl.permissions ?? {},
    roles: acl.roles ?? {},
    endpoints: acl.endpoints ?? {},
  };
  lines.push('TOOL OUTPUTS (already executed by host):');
  lines.push('list_workspace =>');
  lines.push(truncate(JSON.stringify(workspaceToolView, null, 2)));
  lines.push('get_acl_config =>');
  lines.push(truncate(JSON.stringify(aclToolView, null, 2)));
  if (actor) {
    lines.push('actor_access =>');
    lines.push(
      truncate(
        JSON.stringify(
          {
            role: actor.role,
            permissions: actor.permissions,
          },
          null,
          2
        )
      )
    );
  }
  lines.push('');
  lines.push('CANONICAL VIRTUAL PATHS FOR MUTATIONS (use these exact roots):');
  lines.push('- modules/... (backend modules)');
  lines.push('- models/... (orm models)');
  lines.push('- ui/... (tenant ui entities)');
  lines.push('- shared-ui/<project>/... (shared ui files)');
  lines.push('- shared-modules/<project>/... (shared backend files)');
  lines.push('UI path mapping rules:');
  lines.push('- ui/<name>.ui.jsx => package "<name>"');
  lines.push('- ui/<name>/index.jsx => package "<name>"');
  lines.push('- ui/<name>/components/Card.jsx => package "<name>/components/Card"');
  lines.push('');
  lines.push('VIRTUAL FILE TREE (exact paths seen by IDE logic):');
  workspace.modules.forEach((mod) => {
    lines.push(`- ${toModuleVirtualPath(mod)}`);
  });
  workspace.models.forEach((model) => {
    lines.push(`- ${toModelVirtualPath(model)}`);
  });
  lines.push('- modules/acl/permissions.json');
  lines.push('- modules/acl/roles.json');
  lines.push('- modules/acl/endpoints.json');
  workspace.uiPackages.forEach((pkg) => {
    lines.push(`- ${toUiVirtualPath(pkg)}`);
  });
  sharedUiFiles.forEach((file) => {
    lines.push(`- ${toSharedVirtualPath('shared-ui', file.projectName, file.path)}`);
  });
  sharedModuleFiles.forEach((file) => {
    lines.push(`- ${toSharedVirtualPath('shared-modules', file.projectName, file.path)}`);
  });
  lines.push('');
  lines.push('Workspace snapshot (FULL PROJECT CONTEXT):');
  if (actor) {
    lines.push(`Actor role: ${actor.role}`);
    lines.push(
      `Actor permissions (${Array.isArray(actor.permissions) ? actor.permissions.length : 0}):`
    );
    (actor.permissions || []).forEach((permission) => {
      lines.push(`- ${permission}`);
    });
  }
  if (workspace.tenant) {
    lines.push(`Tenant: ${workspace.tenant.hostname} (id:${workspace.tenant.id})`);
    lines.push('Tenant adapterAccess JSON:');
    lines.push(truncate(JSON.stringify(workspace.tenant.adapterAccess ?? {}, null, 2)));
    lines.push('Tenant resourceConfig JSON:');
    lines.push(truncate(JSON.stringify(workspace.tenant.resourceConfig ?? {}, null, 2)));
  }
  lines.push(`Modules (${workspace.modules.length}):`);
  workspace.modules.forEach((mod) => {
    lines.push(`- ${mod.method} ${mod.routePath} (id:${mod.id})`);
  });
  lines.push(`ORM Models (${workspace.models.length}):`);
  workspace.models.forEach((model) => {
    lines.push(`- ${model.path} (id:${model.id})`);
  });
  lines.push(`UI Packages (${workspace.uiPackages.length}):`);
  workspace.uiPackages.forEach((pkg) => {
    const ext = pkg.fileExtension ? `.${pkg.fileExtension}` : '';
    lines.push(`- ${pkg.name}@${pkg.version}${ext} (id:${pkg.id})`);
  });
  lines.push(`Shared UI Projects (${workspace.sharedUi.length}):`);
  workspace.sharedUi.forEach((pkg) => {
    lines.push(`- ${pkg.name}@${pkg.version} (id:${pkg.id})`);
  });
  lines.push(`Shared Module Projects (${workspace.sharedModules.length}):`);
  workspace.sharedModules.forEach((pkg) => {
    lines.push(`- ${pkg.name}@${pkg.version} (id:${pkg.id})`);
  });
  lines.push('ACL Permissions JSON:');
  lines.push(truncate(JSON.stringify(acl.permissions ?? {}, null, 2)));
  lines.push('ACL Roles JSON:');
  lines.push(truncate(JSON.stringify(acl.roles ?? {}, null, 2)));
  lines.push('ACL Endpoints JSON:');
  lines.push(truncate(JSON.stringify(acl.endpoints ?? {}, null, 2)));
  lines.push('');
  lines.push('--- FULL SOURCE: BACKEND MODULES ---');
  workspace.modules.forEach((mod) => {
    lines.push(`# FILE: ${toModuleVirtualPath(mod)}`);
    lines.push(mod.code || '');
    lines.push('');
  });
  lines.push('--- FULL SOURCE: ORM MODELS ---');
  workspace.models.forEach((model) => {
    lines.push(`# FILE: ${toModelVirtualPath(model)}`);
    lines.push(model.code || '');
    lines.push('');
  });
  lines.push('--- FULL SOURCE: ACL JSON ---');
  lines.push('# FILE: modules/acl/permissions.json');
  lines.push(JSON.stringify(acl.permissions ?? {}, null, 2));
  lines.push('');
  lines.push('# FILE: modules/acl/roles.json');
  lines.push(JSON.stringify(acl.roles ?? {}, null, 2));
  lines.push('');
  lines.push('# FILE: modules/acl/endpoints.json');
  lines.push(JSON.stringify(acl.endpoints ?? {}, null, 2));
  lines.push('');
  lines.push('--- FULL SOURCE: UI PACKAGES ---');
  workspace.uiPackages.forEach((pkg) => {
    lines.push(`# FILE: ${toUiVirtualPath(pkg)} @${pkg.version}`);
    if (pkg.dependencies?.length) {
      lines.push(`# DEPENDENCIES: ${pkg.dependencies.join(', ')}`);
    }
    lines.push(pkg.code || '');
    lines.push('');
  });
  lines.push('--- FULL SOURCE: SHARED UI PROJECT FILES ---');
  if (sharedUiFiles.length) {
    sharedUiFiles.forEach((file) => {
      lines.push(`# FILE: ${toSharedVirtualPath('shared-ui', file.projectName, file.path)}`);
      lines.push(file.content || '');
      lines.push('');
    });
  } else {
    workspace.sharedUi.forEach((project) => {
      lines.push(
        `# FILE: ${toSharedVirtualPath('shared-ui', project.name, project.entryPath)} @${project.version}`
      );
      if (project.dependencies?.length) {
        lines.push(`# DEPENDENCIES: ${project.dependencies.join(', ')}`);
      }
      lines.push(project.code || '');
      lines.push('');
    });
  }
  lines.push('--- FULL SOURCE: SHARED BACKEND PROJECT FILES ---');
  if (sharedModuleFiles.length) {
    sharedModuleFiles.forEach((file) => {
      lines.push(
        `# FILE: ${toSharedVirtualPath('shared-modules', file.projectName, file.path)}`
      );
      lines.push(file.content || '');
      lines.push('');
    });
  } else {
    workspace.sharedModules.forEach((project) => {
      lines.push(
        `# FILE: ${toSharedVirtualPath('shared-modules', project.name, project.entryPath)} @${project.version}`
      );
      if (project.dependencies?.length) {
        lines.push(`# DEPENDENCIES: ${project.dependencies.join(', ')}`);
      }
      lines.push(project.code || '');
      lines.push('');
    });
  }
  lines.push('--- PREVIEW EXCEPTIONS ---');
  if (preview?.enabled) {
    lines.push(`Watch mode: enabled (captured ${preview.exceptions.length} recent event(s))`);
    preview.exceptions.forEach((item, index) => {
      lines.push(
        `# EXCEPTION ${index + 1}: [${item.level}] ${item.kind} at ${item.createdAt}`
      );
      lines.push(`message: ${item.message}`);
      if (item.requestUrl) {
        lines.push(
          `request: ${item.method || 'GET'} ${item.requestUrl}${item.status ? ` (status ${item.status})` : ''}`
        );
      }
      if (item.sourceUrl) {
        lines.push(
          `source: ${item.sourceUrl}${
            item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : ''
          }`
        );
      }
      if (item.previewName || item.previewVersion) {
        lines.push(`preview: ${item.previewName || '-'}@${item.previewVersion || '-'}`);
      }
      if (item.responseSnippet) {
        lines.push(`response: ${item.responseSnippet}`);
      }
      if (item.stack) {
        lines.push('stack:');
        lines.push(truncate(item.stack, 2000));
      }
      lines.push('');
    });
  } else {
    lines.push('Watch mode: disabled');
  }
  return lines.join('\n');
};

type CodexResolvedPlan = {
  message: string;
  plan: CodexPlan | null;
  operations: CodexOperation[];
};

type ExecuteCodexPipelineInput = {
  runId: string;
  userId: string | number;
  userName?: string;
  chatId: string;
  messages: Array<{ role: string; content: string }>;
  contextText: string;
  systemPrompt: string;
  model?: string;
  tools: Record<string, any>;
  workspace: WorkspaceContext;
  changes: AssistantChange[];
  onProgress?: (line: string) => void;
  onChange?: (change: AssistantChange) => void;
  onEvent?: (event: AssistantRunEvent) => void;
};

type ExecuteCodexPipelineResult = {
  status: 'completed' | 'failed';
  message: string;
  finishReason: string;
  usage: undefined;
  events: AssistantRunEvent[];
  changes: AssistantChange[];
  artifacts: Array<{ id: string; kind: string; payload: unknown }>;
  dag: {
    nodes: Array<{
      id: string;
      label: string;
      phase: AssistantRunEvent['phase'];
      status: 'pending' | 'running' | 'completed' | 'failed';
      attempt: number;
    }>;
    edges: Array<{
      fromNodeId: string;
      toNodeId: string;
      eventType: AssistantRunEvent['type'];
    }>;
  };
  conflicts: CodexConflict[];
};

const resolveCodexPlan = async (
  input: {
    runId: string;
    userId: string | number;
    userName?: string;
    chatId: string;
    messages: Array<{ role: string; content: string }>;
    contextText: string;
    systemPrompt: string;
    model?: string;
    workspace: WorkspaceContext;
  },
  onProgress?: (line: string) => void
): Promise<CodexResolvedPlan> => {
  const codex = await executeCodex({
    runId: input.runId,
    userId: input.userId,
    userName: input.userName,
    chatId: input.chatId,
    messages: input.messages,
    contextText: input.contextText,
    systemPrompt: input.systemPrompt,
    model: input.model,
    onLine: (line) => {
      const formatted = formatCodexProgressLine(line);
      if (!formatted?.text) return;
      onProgress?.(formatted.text);
    },
  });

  onProgress?.('[codex] response received, resolving operations...');

  let codexMessage = codex.message;
  let plan = parseCodexPlan(codexMessage);
  let fallbackDirectives = parseCodexFileDirectives(codexMessage);
  let fallbackOperations = buildOperationsFromDirectives(
    fallbackDirectives,
    input.workspace
  );
  let operations = (plan?.operations?.length ? plan.operations : fallbackOperations) ?? [];

  if (operations.length === 0 && codexAskedForUnavailableTools(codexMessage)) {
    const latestPrompt = getLatestUserPrompt(input.messages);
    onProgress?.('[codex] direct tool request detected, retrying with host context...');
    const recovery = await executeCodex({
      runId: input.runId,
      userId: input.userId,
      userName: input.userName,
      chatId: input.chatId,
      messages: [
        ...input.messages,
        { role: 'user', content: buildCodexRecoveryPrompt(latestPrompt) },
      ],
      contextText: input.contextText,
      systemPrompt: input.systemPrompt,
      model: input.model,
      onLine: (line) => {
        const formatted = formatCodexProgressLine(line);
        if (!formatted?.text) return;
        onProgress?.(formatted.text);
      },
    });
    codexMessage = recovery.message;
    plan = parseCodexPlan(codexMessage);
    fallbackDirectives = parseCodexFileDirectives(codexMessage);
    fallbackOperations = buildOperationsFromDirectives(
      fallbackDirectives,
      input.workspace
    );
    operations = (plan?.operations?.length ? plan.operations : fallbackOperations) ?? [];
  }

  if (plan?.operations?.length) {
    onProgress?.(`[codex] parsed ${plan.operations.length} operation(s) from JSON plan`);
  } else if (fallbackDirectives.length) {
    onProgress?.(
      `[codex] parsed ${fallbackDirectives.length} file directive(s), mapped to ${fallbackOperations.length} operation(s)`
    );
  } else {
    onProgress?.('[codex] no explicit operations in response');
  }

  return { message: codexMessage, plan, operations };
};

const executeCodexPipeline = async (
  input: ExecuteCodexPipelineInput
): Promise<ExecuteCodexPipelineResult> => {
  const events: AssistantRunEvent[] = [];
  const conflictHistory: CodexConflict[] = [];
  let unresolvedConflicts: CodexConflict[] = [];
  const emitEvent = (
    type: AssistantRunEvent['type'],
    phase: AssistantRunEvent['phase'],
    payload?: Record<string, unknown>
  ) => {
    const event = createRunEvent(input.runId, type, phase, payload);
    events.push(event);
    input.onEvent?.(event);
    return event;
  };
  const progress = (line: string) => {
    const text = String(line || '').trim();
    if (!text) return;
    input.onProgress?.(text);
  };

  emitEvent('RUN_REQUESTED', 'S0_INIT', { mode: 'codex', agentType: resolveAgentType() });
  emitEvent('CONTEXT_CAPTURED', 'S0_INIT');
  emitEvent('EXECUTION_STARTED', 'S2_EXTRACTION');

  const latestPrompt = getLatestUserPrompt(input.messages);
  let lastMessage = '';
  let activePlan: CodexPlan | null = null;
  let allOperations: CodexOperation[] = [];
  let totalLogs: string[] = [];
  let totalErrors: string[] = [];
  let totalExecuted = 0;
  let totalMutationOps = 0;

  try {
    let currentMessages = input.messages;
    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
      const resolved = await resolveCodexPlan(
        {
          runId: input.runId,
          userId: input.userId,
          userName: input.userName,
          chatId: input.chatId,
          messages: currentMessages,
          contextText: input.contextText,
          systemPrompt: input.systemPrompt,
          model: input.model,
          workspace: input.workspace,
        },
        progress
      );
      lastMessage = resolved.message;
      if (resolved.plan) activePlan = resolved.plan;
      allOperations = allOperations.concat(resolved.operations);

      if (resolved.operations.length > 0) {
        emitEvent('PLAN_READY', 'S1_ANALYSIS', {
          operationCount: resolved.operations.length,
          attempt: attempt + 1,
        });
      }

      if (attempt === 0 && promptLooksLikeMutation(latestPrompt) && resolved.operations.length === 0) {
        const missingOpsConflict = createConflict(
          'Codex returned no operations for a mutation request.',
          'high',
          []
        );
        unresolvedConflicts = [missingOpsConflict];
        conflictHistory.push(missingOpsConflict);
      }

      const opResult =
        resolved.operations.length > 0
          ? await executeCodexOperations(
              input.tools,
              resolved.operations,
              input.workspace,
              () => input.changes,
              input.onChange,
              (line) => progress(line)
            )
          : { executed: 0, mutationOps: 0, logs: [] as string[], errors: [] as string[] };

      totalExecuted += opResult.executed;
      totalMutationOps += opResult.mutationOps;
      totalLogs = totalLogs.concat(opResult.logs);
      totalErrors = totalErrors.concat(opResult.errors);

      progress(
        `[codex] operations done: executed ${opResult.executed}/${resolved.operations.length}, mutations ${opResult.mutationOps}, changes ${input.changes.length}`
      );

      const detected = buildCoverageConflicts(
        latestPrompt,
        allOperations,
        input.changes,
        opResult.errors,
        []
      );
      if (!detected.length) {
        unresolvedConflicts = [];
        break;
      }

      unresolvedConflicts = detected;
      detected.forEach((item) => conflictHistory.push(item));
      emitEvent('CONFLICT_FOUND', 'S3_SYNTHESIS', {
        attempt: attempt + 1,
        count: detected.length,
        messages: detected.map((item) => item.message),
      });

      if (attempt >= MAX_REPAIR_ATTEMPTS - 1) {
        break;
      }

      emitEvent('RETRY_REQUESTED', 'S3_SYNTHESIS', {
        attempt: attempt + 2,
      });
      progress(`[codex] targeted repair attempt ${attempt + 2}/${MAX_REPAIR_ATTEMPTS}`);
      currentMessages = [
        ...input.messages,
        {
          role: 'user',
          content: buildTargetedRepairPrompt(latestPrompt, detected),
        },
      ];
    }

    if (unresolvedConflicts.length) {
      const latestConflict = unresolvedConflicts[unresolvedConflicts.length - 1];
      const conflictSummary =
        latestConflict?.message ||
        unresolvedConflicts.map((item) => item.message).filter(Boolean).slice(0, 3).join(' | ') ||
        totalErrors.slice(0, 3).join(' | ') ||
        'Conflict detected after repair attempts';
      const failureMessage = `Codex pipeline failed: ${conflictSummary}`;
      emitEvent('RUN_FAILED', 'S4_PRODUCTION', {
        message: failureMessage,
      });
      const dag = buildCodexDagFromEvents(input.runId, events);
      return {
        status: 'failed',
        message: failureMessage,
        finishReason: 'codex-conflict',
        usage: undefined,
        events,
        changes: [...input.changes],
        artifacts: [
          { id: `${input.runId}-messages`, kind: 'request_messages', payload: input.messages },
          { id: `${input.runId}-context`, kind: 'workspace_context', payload: input.contextText },
          { id: `${input.runId}-plan`, kind: 'execution_plan', payload: activePlan ?? {} },
          { id: `${input.runId}-changes`, kind: 'workspace_changes', payload: input.changes },
          {
            id: `${input.runId}-validation`,
            kind: 'validation_report',
            payload: conflictHistory,
          },
        ],
        dag,
        conflicts: unresolvedConflicts,
      };
    }

    const summary = (activePlan?.summary || '').trim() || lastMessage.trim() || 'Done.';
    const finalMessageLines = [summary];
    if (totalLogs.length) {
      finalMessageLines.push('');
      finalMessageLines.push(...totalLogs.map((line) => `- ${line}`));
    }
    if (totalErrors.length) {
      finalMessageLines.push('');
      finalMessageLines.push(...totalErrors.map((line) => `- ${line}`));
    }
    finalMessageLines.push('');
    finalMessageLines.push(
      `[pipeline] executed=${totalExecuted} mutationOps=${totalMutationOps} changes=${input.changes.length}`
    );
    const finalMessage = finalMessageLines.join('\n').trim();

    emitEvent('EXECUTION_COMPLETED', 'S3_SYNTHESIS');
    emitEvent('RUN_COMPLETED', 'S4_PRODUCTION');
    const dag = buildCodexDagFromEvents(input.runId, events);

    return {
      status: 'completed',
      message: finalMessage,
      finishReason: 'codex-complete',
      usage: undefined,
      events,
      changes: [...input.changes],
      artifacts: [
        { id: `${input.runId}-messages`, kind: 'request_messages', payload: input.messages },
        { id: `${input.runId}-context`, kind: 'workspace_context', payload: input.contextText },
        { id: `${input.runId}-plan`, kind: 'execution_plan', payload: activePlan ?? {} },
        { id: `${input.runId}-changes`, kind: 'workspace_changes', payload: input.changes },
        { id: `${input.runId}-output`, kind: 'execution_output', payload: finalMessage },
      ],
      dag,
      conflicts: [],
    };
  } catch (error) {
    const errorMessage =
      String((error as Error).message || '').trim() ||
      unresolvedConflicts.map((item) => item.message).filter(Boolean).slice(0, 3).join(' | ') ||
      'Codex execution failed';
    const failureMessage = `Codex pipeline failed: ${errorMessage}`;
    emitEvent('RUN_FAILED', 'S4_PRODUCTION', {
      message: failureMessage,
    });
    const dag = buildCodexDagFromEvents(input.runId, events);
    return {
      status: 'failed',
      message: failureMessage,
      finishReason: 'codex-error',
      usage: undefined,
      events,
      changes: [...input.changes],
      artifacts: [
        { id: `${input.runId}-messages`, kind: 'request_messages', payload: input.messages },
        { id: `${input.runId}-context`, kind: 'workspace_context', payload: input.contextText },
        { id: `${input.runId}-changes`, kind: 'workspace_changes', payload: input.changes },
      ],
      dag,
      conflicts: unresolvedConflicts,
    };
  }
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const user = await requireUser(req);
  const tenant = await resolveTenant(req);
  const allowClientConfig = process.env.AI_ALLOW_CLIENT_CONFIG === 'true';

  const {
    messages,
    config,
    stream,
    context: rawContext,
    chatId: rawChatId,
    systemPrompt: rawSystemPrompt,
  } = req.body ?? {};
  const chatId =
    typeof rawChatId === 'string' && rawChatId.trim()
      ? rawChatId.trim().slice(0, 128)
      : 'default';
  const normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length) {
    const err = new Error('Messages are required');
    (err as any).statusCode = 400;
    throw err;
  }

  const changes: AssistantChange[] = [];
  const tools = buildAssistantTools({
    tenant,
    userId: user.id,
    role: user.normalizedRole,
    permissions: user.permissions,
    isAdmin: user.isAdmin,
    activeTeamId: user.activeTeamId,
    changes,
  });

  const workspace = await executeTool<WorkspaceContext, Record<string, never>>(
    tools.list_workspace,
    {}
  );
  const acl = await executeTool<{
    permissions: unknown;
    roles: unknown;
    endpoints: unknown;
  }, Record<string, never>>(tools.get_acl_config, {});
  const context =
    rawContext && typeof rawContext === 'object'
      ? (rawContext as {
          watchPreviewExceptions?: unknown;
          previewExceptionsLimit?: unknown;
        })
      : null;
  const watchPreviewExceptions =
    context?.watchPreviewExceptions === true || shouldWatchPreviewFromPrompt(normalizedMessages);
  const previewExceptionsLimit = resolvePreviewExceptionsLimit(
    context?.previewExceptionsLimit
  );
  const previewExceptions = watchPreviewExceptions
    ? await listPreviewExceptions(tenant.id, String(user.id), previewExceptionsLimit)
    : [];
  const contextText = buildContextText(
    {
      tenant: workspace.tenant ?? undefined,
      modules: workspace.modules ?? [],
      models: workspace.models ?? [],
      uiPackages: workspace.uiPackages ?? [],
      sharedUi: workspace.sharedUi ?? [],
      sharedModules: workspace.sharedModules ?? [],
      sharedUiFiles: workspace.sharedUiFiles ?? [],
      sharedModuleFiles: workspace.sharedModuleFiles ?? [],
    },
    {
      permissions: acl.permissions,
      roles: acl.roles,
      endpoints: acl.endpoints,
    },
    {
      enabled: watchPreviewExceptions,
      exceptions: previewExceptions,
    },
    {
      role: user.normalizedRole,
      permissions: user.permissions || [],
    }
  );

  const idempotency = buildAssistantIdempotencyKey(normalizedMessages, contextText);
  const runId = createRunId(chatId);
  const existingRunSummary = await getAssistantRunSummary(tenant.id, runId);
  const runName = existingRunSummary?.runName || buildRunName(normalizedMessages);
  const reservation = await reserveAssistantRun(tenant.id, runId, idempotency);
  if (reservation.reusedRunId) {
    const cached = await getAssistantRun(tenant.id, reservation.reusedRunId);
    if (cached) {
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        (res as any).flushHeaders?.();
        res.write(
          `data: ${JSON.stringify({
            type: 'start',
            runId: cached.runId,
          })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            message: cached.message,
            changes: Array.isArray((cached as any).changes) ? (cached as any).changes : [],
            finishReason: cached.finishReason,
            runId: cached.runId,
            usage: cached.usage,
            events: cached.events,
            dag: cached.dag,
            conflicts: cached.conflicts,
            cached: true,
          })}\n\n`
        );
        res.end();
        return;
      }
      res.status(200).json({
        message: cached.message,
        changes: Array.isArray((cached as any).changes) ? (cached as any).changes : [],
        finishReason: cached.finishReason,
        runId: cached.runId,
        usage: cached.usage,
        events: cached.events,
        dag: cached.dag,
        conflicts: cached.conflicts,
        cached: true,
      });
      return;
    }
    const summary = await getAssistantRunSummary(tenant.id, reservation.reusedRunId);
    if (summary?.status === 'running') {
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        (res as any).flushHeaders?.();
        res.write(
          `data: ${JSON.stringify({
            type: 'start',
            runId: reservation.reusedRunId,
          })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({
            type: 'done',
            message: 'Equivalent run is already in progress. Retry in a few seconds.',
            changes,
            runId: reservation.reusedRunId,
            pending: true,
          })}\n\n`
        );
        res.end();
        return;
      }
      res.status(202).json({
        message: 'Equivalent run is already in progress. Retry in a few seconds.',
        runId: reservation.reusedRunId,
        pending: true,
      });
      return;
    }
  }
  await startAssistantRun(tenant.id, runId, { idempotency, runName });

  if (isCodexAgentMode()) {
    const systemPrompt = normalizeSystemPrompt(
      rawSystemPrompt,
      CODEX_SYSTEM_INSTRUCTIONS
    );
    const codexModel = resolveCodexModel(config ?? {}, allowClientConfig);
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      (res as any).flushHeaders?.();

      const sendEvent = (payload: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      sendEvent({ type: 'start', runId });
      const pipeline = await executeCodexPipeline({
        runId,
        userId: user.id,
        userName: user.email,
        chatId,
        messages: normalizedMessages,
        contextText,
        systemPrompt,
        model: codexModel,
        tools: tools as Record<string, any>,
        workspace,
        changes,
        onProgress: (line) => sendEvent({ type: 'progress', line }),
        onChange: (change) => sendEvent({ type: 'change', change }),
        onEvent: (event) => {
          sendEvent({ type: 'run_event', event });
          void appendAssistantEvent(tenant.id, runId, event).catch(() => undefined);
        },
      });
      const now = new Date().toISOString();
      await completeAssistantRun({
        runId,
        tenantId: tenant.id,
        runName,
        status: pipeline.status,
        message: pipeline.message,
        finishReason: pipeline.finishReason,
        usage: pipeline.usage,
        createdAt: pipeline.events[0]?.timestamp ?? now,
        updatedAt: now,
        idempotencyKey: idempotency,
        events: pipeline.events,
        changes: pipeline.changes,
        artifacts: pipeline.artifacts,
        dag: pipeline.dag,
        conflicts: pipeline.conflicts,
      });
      if (pipeline.status === 'failed') {
        const errorMessage =
          pipeline.conflicts[0]?.message ||
          pipeline.message ||
          `Codex pipeline failed (${pipeline.finishReason || 'unknown reason'})`;
        sendEvent({
          type: 'error',
          message: errorMessage,
        });
      }
      sendEvent({
        type: 'done',
        message: pipeline.message,
        changes: pipeline.changes,
        finishReason: pipeline.finishReason,
        runId,
        usage: pipeline.usage,
        events: pipeline.events,
        dag: pipeline.dag,
        conflicts: pipeline.conflicts,
      });
      res.end();
      return;
    }
    const pipeline = await executeCodexPipeline({
      runId,
      userId: user.id,
      userName: user.email,
      chatId,
      messages: normalizedMessages,
      contextText,
      systemPrompt,
      model: codexModel,
      tools: tools as Record<string, any>,
      workspace,
      changes,
      onEvent: (event) => {
        void appendAssistantEvent(tenant.id, runId, event).catch(() => undefined);
      },
    });
    const now = new Date().toISOString();
    await completeAssistantRun({
      runId,
      tenantId: tenant.id,
      runName,
      status: pipeline.status,
      message: pipeline.message,
      finishReason: pipeline.finishReason,
      usage: pipeline.usage,
      createdAt: pipeline.events[0]?.timestamp ?? now,
      updatedAt: now,
      idempotencyKey: idempotency,
      events: pipeline.events,
      changes: pipeline.changes,
      artifacts: pipeline.artifacts,
      dag: pipeline.dag,
      conflicts: pipeline.conflicts,
    });
    if (pipeline.status === 'failed') {
      throw new Error(
        pipeline.conflicts[0]?.message || pipeline.message || 'Codex execution failed'
      );
    }
    res.status(200).json({
      message: pipeline.message,
      changes: pipeline.changes,
      finishReason: pipeline.finishReason,
      runId,
      usage: pipeline.usage,
      events: pipeline.events,
      dag: pipeline.dag,
      conflicts: pipeline.conflicts,
    });
    return;
  }

  const modelConfig = await pickAvailableModel(
    buildAssistantModelConfig(config ?? {}, allowClientConfig)
  );
  const systemPrompt = normalizeSystemPrompt(
    rawSystemPrompt,
    ASSISTANT_SYSTEM_INSTRUCTIONS
  );
  const agent = createAssistantAgent(tools as any, modelConfig);

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    (res as any).flushHeaders?.();

    const sendEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      let closed = false;
      req.on('close', () => {
        closed = true;
      });
      let startSent = false;
      const emitRunEvent = (event: AssistantRunEvent) => {
        if (closed) return;
        if (!startSent) {
          sendEvent({ type: 'start', runId: event.runId });
          startSent = true;
        }
        sendEvent({ type: 'run_event', event });
      };
      const run = await executeAssistantRun({
        runId,
        agent,
        messages: normalizedMessages,
        systemPrompt,
        contextText,
        maxSteps: 24,
        maxRetries: 1,
        onDelta: (content) => {
          if (!closed && content) {
            sendEvent({ type: 'delta', content });
          }
        },
        onEvent: (event) => {
          emitRunEvent(event);
          void appendAssistantEvent(tenant.id, runId, event).catch(() => undefined);
        },
        collectChanges: () => changes,
      });
      const status = run.events.some((event) => event.type === 'RUN_FAILED')
        ? 'failed'
        : 'completed';
      await completeAssistantRun({
        runId,
        tenantId: tenant.id,
        runName,
        status,
        message: run.message || '',
        finishReason: run.finishReason,
        usage: run.usage,
        createdAt: run.events[0]?.timestamp ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        idempotencyKey: idempotency,
        events: run.events,
        changes,
        artifacts: [
          ...run.artifacts,
          { id: `${runId}-changes`, kind: 'workspace_changes', payload: changes },
        ],
        dag: run.dag,
        conflicts: run.conflicts,
      });
      sendEvent({
        type: 'done',
        message: run.message || '',
        changes,
        finishReason: run.finishReason,
        runId,
        usage: run.usage,
        events: run.events,
        dag: run.dag,
        conflicts: run.conflicts,
      });
      res.end();
      return;
    } catch (err) {
      const now = new Date().toISOString();
      await completeAssistantRun({
        runId,
        tenantId: tenant.id,
        runName,
        status: 'failed',
        message: '',
        finishReason: 'error',
        usage: undefined,
        createdAt: now,
        updatedAt: now,
        idempotencyKey: idempotency,
        events: [],
        changes: [],
        artifacts: [
          { id: `${runId}-messages`, kind: 'request_messages', payload: normalizedMessages },
          { id: `${runId}-context`, kind: 'workspace_context', payload: contextText },
          { id: `${runId}-changes`, kind: 'workspace_changes', payload: [] },
        ],
        dag: { nodes: [], edges: [] },
        conflicts: [],
      });
      sendEvent({
        type: 'error',
        message: (err as Error).message || 'Streaming failed',
      });
      res.end();
      return;
    }
  }

  const run = await executeAssistantRun({
    runId,
    agent,
    messages: normalizedMessages,
    systemPrompt,
    contextText,
    maxSteps: 24,
    maxRetries: 1,
    onEvent: (event) => {
      void appendAssistantEvent(tenant.id, runId, event).catch(() => undefined);
    },
    collectChanges: () => changes,
  });
  const status = run.events.some((event) => event.type === 'RUN_FAILED')
    ? 'failed'
    : 'completed';
  await completeAssistantRun({
    runId,
    tenantId: tenant.id,
    runName,
    status,
    message: run.message || '',
    finishReason: run.finishReason,
    usage: run.usage,
    createdAt: run.events[0]?.timestamp ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    idempotencyKey: idempotency,
    events: run.events,
    changes,
    artifacts: [
      ...run.artifacts,
      { id: `${runId}-changes`, kind: 'workspace_changes', payload: changes },
    ],
    dag: run.dag,
    conflicts: run.conflicts,
  });

  res.status(200).json({
    message: run.message || '',
    changes,
    finishReason: run.finishReason,
    runId,
    usage: run.usage,
    events: run.events,
    dag: run.dag,
    conflicts: run.conflicts,
  });
});
