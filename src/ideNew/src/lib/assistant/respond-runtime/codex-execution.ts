import type { AssistantChange } from '@/lib/assistant/types';
import type { CodexOperation, FileDirective } from './codex-types';
import { executeTool } from './codex-types';
import { buildOperationsFromDirectives } from './codex-directives';
import {
  normalizeOperationInput,
  pickInput,
  toToolId,
} from './codex-normalization';
import type { WorkspaceContext } from './workspace-context';

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

export const executeCodexOperations = async (
  tools: Record<string, any>,
  operations: CodexOperation[],
  workspace: WorkspaceContext,
  getChanges: () => AssistantChange[],
  onChange?: (change: AssistantChange) => void,
  onProgress?: (line: string) => void,
) => {
  const logs: string[] = [];
  const errors: string[] = [];
  let executed = 0;
  let mutationOps = 0;
  let seenChanges = getChanges().length;

  const applySingleOperation = async (
    operation: CodexOperation,
    indexLabel: string,
  ) => {
    const toolId = toToolId(
      String(operation.tool || operation.name || operation.action || operation.toolId || ''),
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
        fallbackInput.id = (input as Record<string, unknown>).id;
        fallbackInput.routePath = (input as Record<string, unknown>).routePath;
        fallbackInput.method = (input as Record<string, unknown>).method;
        fallbackInput.code = (input as Record<string, unknown>).code;
        fallbackInput.fileExtension = (input as Record<string, unknown>).fileExtension;
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
              (fallbackError as Error).message || fallbackError,
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
        workspace,
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
