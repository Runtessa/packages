import {
  buildOperationsFromDirectives,
  formatCodexProgressLine,
  parseCodexFileDirectives,
  parseCodexPlan,
  type CodexOperation,
  type CodexPlan,
} from './codex-ops';
import type { WorkspaceContext } from './workspace-context';
import { executeCodex, getLatestUserPrompt } from './codex-client';

type CodexResolvedPlan = {
  message: string;
  plan: CodexPlan | null;
  operations: CodexOperation[];
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

type ResolvePlanInput = {
  runId: string;
  userId: string | number;
  userName?: string;
  chatId: string;
  messages: Array<{ role: string; content: string }>;
  contextText: string;
  systemPrompt: string;
  model?: string;
  workspace: WorkspaceContext;
};

export const resolveCodexPlan = async (
  input: ResolvePlanInput,
  onProgress?: (line: string) => void,
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
  let fallbackOperations = buildOperationsFromDirectives(fallbackDirectives, input.workspace);
  let operations = (plan?.operations?.length ? plan.operations : fallbackOperations) ?? [];

  if (operations.length === 0 && codexAskedForUnavailableTools(codexMessage)) {
    const latestPrompt = getLatestUserPrompt(input.messages);
    onProgress?.('[codex] direct tool request detected, retrying with host context...');
    const recovery = await executeCodex({
      runId: input.runId,
      userId: input.userId,
      userName: input.userName,
      chatId: input.chatId,
      messages: [...input.messages, { role: 'user', content: buildCodexRecoveryPrompt(latestPrompt) }],
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
    fallbackOperations = buildOperationsFromDirectives(fallbackDirectives, input.workspace);
    operations = (plan?.operations?.length ? plan.operations : fallbackOperations) ?? [];
  }

  if (plan?.operations?.length) {
    onProgress?.(`[codex] parsed ${plan.operations.length} operation(s) from JSON plan`);
  } else if (fallbackDirectives.length) {
    onProgress?.(
      `[codex] parsed ${fallbackDirectives.length} file directive(s), mapped to ${fallbackOperations.length} operation(s)`,
    );
  } else {
    onProgress?.('[codex] no explicit operations in response');
  }

  return { message: codexMessage, plan, operations };
};

export type { CodexResolvedPlan, ResolvePlanInput };
