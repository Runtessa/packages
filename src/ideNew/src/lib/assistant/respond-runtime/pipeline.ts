import type { AssistantChange } from '@/lib/assistant/types';
import type { AssistantRunEvent } from '@/lib/assistant/orchestrator';
import { executeCodexOperations, type CodexOperation, type CodexPlan } from './codex-ops';
import type { WorkspaceContext } from './workspace-context';
import { resolveAgentType } from './codex-client';
import { resolveCodexPlan } from './pipeline-plan';
import {
  buildCodexDagFromEvents,
  buildCoverageConflicts,
  buildTargetedRepairPrompt,
  createRunEvent,
  promptLooksLikeMutation,
  type CodexConflict,
} from './pipeline-shared';

const MAX_REPAIR_ATTEMPTS = 2;

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

export const executeCodexPipeline = async (
  input: ExecuteCodexPipelineInput,
): Promise<ExecuteCodexPipelineResult> => {
  const events: AssistantRunEvent[] = [];
  const conflictHistory: CodexConflict[] = [];
  let unresolvedConflicts: CodexConflict[] = [];
  const emitEvent = (
    type: AssistantRunEvent['type'],
    phase: AssistantRunEvent['phase'],
    payload?: Record<string, unknown>,
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

  const latestPrompt = [...input.messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim())?.content || '';
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
        progress,
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
        const missingOpsConflict: CodexConflict = {
          id:
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `conflict-${Math.random().toString(36).slice(2, 10)}`,
          message: 'Codex returned no operations for a mutation request.',
          severity: 'high',
          relatedNodeIds: [],
        };
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
              (line) => progress(line),
            )
          : { executed: 0, mutationOps: 0, logs: [] as string[], errors: [] as string[] };

      totalExecuted += opResult.executed;
      totalMutationOps += opResult.mutationOps;
      totalLogs = totalLogs.concat(opResult.logs);
      totalErrors = totalErrors.concat(opResult.errors);

      progress(
        `[codex] operations done: executed ${opResult.executed}/${resolved.operations.length}, mutations ${opResult.mutationOps}, changes ${input.changes.length}`,
      );

      const detected = buildCoverageConflicts(
        latestPrompt,
        allOperations,
        input.changes,
        opResult.errors,
        [],
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
      `[pipeline] executed=${totalExecuted} mutationOps=${totalMutationOps} changes=${input.changes.length}`,
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

export type { CodexConflict, ExecuteCodexPipelineInput, ExecuteCodexPipelineResult };
