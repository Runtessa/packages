import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveCodexGatewayBase } from '@/lib/assistant/gateway';
import {
  resolveCodexGatewayBaseForUser,
  resolveCodexGatewayModeValue,
} from '@/lib/assistant/gateway-runtime';

const resolveAgentType = () => (process.env.AGENT_TYPE || '').trim().toLowerCase();

export const isCodexAgentMode = () => resolveAgentType() === 'codex';

export const resolveCodexCwd = () => {
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

const buildCodexPrompt = (
  messages: Array<{ role: string; content: string }>,
  contextText: string,
  systemPrompt: string,
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

  const history = messages.map((msg) => `[${msg.role}] ${msg.content}`).join('\n\n');
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

export type CodexExecInput = {
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
  const prompt = buildCodexPrompt(input.messages, input.contextText, input.systemPrompt);
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
      if (model) args.push('-m', model);
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

  if (!message) message = stdoutText.trim();
  if (!message) message = 'Codex completed with no response text.';
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
      fullPrompt: buildCodexPrompt(input.messages, input.contextText, input.systemPrompt),
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
      throw new Error(doneError || `codex-gateway terminated codex process (${doneSignal})`);
    }
    throw new Error(doneError || 'codex-gateway execution failed');
  }

  return {
    message: doneMessage || 'Codex completed with no response text.',
  };
};

export const executeCodex = async (input: CodexExecInput) => {
  const mode = resolveCodexGatewayModeValue();
  const gatewayEnabled = mode !== 'off' && mode !== 'none' && mode !== 'disabled';
  const shouldUseGateway =
    gatewayEnabled && (mode === 'container' || Boolean(resolveCodexGatewayUrl()));
  if (shouldUseGateway) {
    return executeCodexGateway(input);
  }
  return executeCodexCli(input);
};

export const getLatestUserPrompt = (messages: Array<{ role: string; content: string }>) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg.role === 'user') return msg.content || '';
  }
  return '';
};

export { resolveAgentType };
