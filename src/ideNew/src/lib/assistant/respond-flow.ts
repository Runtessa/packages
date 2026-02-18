import type { NextApiRequest, NextApiResponse } from 'next';
import { buildAssistantModelConfig, createAssistantAgent } from '@/lib/assistant/agent';
import { executeAssistantRun, type AssistantRunEvent } from '@/lib/assistant/orchestrator';
import {
  appendAssistantEvent,
  completeAssistantRun,
  getAssistantRun,
  getAssistantRunSummary,
} from '@/lib/assistant/state-store';
import type { AssistantChange } from '@/lib/assistant/types';
import type { WorkspaceContext } from '@/lib/assistant/respond-runtime';
import {
  executeCodexPipeline,
  normalizeSystemPrompt,
  pickAvailableModel,
  resolveCodexModel,
} from '@/lib/assistant/respond-runtime';

const openSse = (res: NextApiResponse) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  (res as any).flushHeaders?.();
};

const sendSse = (res: NextApiResponse, payload: Record<string, unknown>) => {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

type CachedRunParams = {
  tenantId: string;
  runId: string;
  reusedRunId: string;
  stream: boolean;
  res: NextApiResponse;
  changes: AssistantChange[];
};

export const tryRespondFromCachedRun = async ({
  tenantId,
  runId,
  reusedRunId,
  stream,
  res,
  changes,
}: CachedRunParams): Promise<boolean> => {
  const cached = await getAssistantRun(tenantId, reusedRunId);
  if (cached) {
    if (stream) {
      openSse(res);
      sendSse(res, { type: 'start', runId: cached.runId });
      sendSse(res, {
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
      });
      res.end();
      return true;
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
    return true;
  }

  const summary = await getAssistantRunSummary(tenantId, reusedRunId);
  if (summary?.status === 'running') {
    if (stream) {
      openSse(res);
      sendSse(res, { type: 'start', runId: reusedRunId });
      sendSse(res, {
        type: 'done',
        message: 'Equivalent run is already in progress. Retry in a few seconds.',
        changes,
        runId: reusedRunId,
        pending: true,
      });
      res.end();
      return true;
    }
    res.status(202).json({
      message: 'Equivalent run is already in progress. Retry in a few seconds.',
      runId: reusedRunId,
      pending: true,
    });
    return true;
  }

  return false;
};

type CodexRunParams = {
  req: NextApiRequest;
  res: NextApiResponse;
  tenantId: string;
  userId: string | number;
  userName?: string;
  chatId: string;
  runId: string;
  runName: string;
  idempotency: string;
  stream: boolean;
  rawSystemPrompt: unknown;
  config: unknown;
  allowClientConfig: boolean;
  messages: Array<{ role: string; content: string }>;
  contextText: string;
  tools: Record<string, unknown>;
  workspace: WorkspaceContext;
  changes: AssistantChange[];
  codexSystemPrompt: string;
};

export const handleCodexRun = async ({
  req,
  res,
  tenantId,
  userId,
  userName,
  chatId,
  runId,
  runName,
  idempotency,
  stream,
  rawSystemPrompt,
  config,
  allowClientConfig,
  messages,
  contextText,
  tools,
  workspace,
  changes,
  codexSystemPrompt,
}: CodexRunParams): Promise<void> => {
  const systemPrompt = normalizeSystemPrompt(rawSystemPrompt, codexSystemPrompt);
  const codexModel = resolveCodexModel((config ?? {}) as { model?: string }, allowClientConfig);

  const completePipeline = async (pipeline: Awaited<ReturnType<typeof executeCodexPipeline>>) => {
    const now = new Date().toISOString();
    await completeAssistantRun({
      runId,
      tenantId,
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
  };

  if (stream) {
    openSse(res);
    sendSse(res, { type: 'start', runId });
    const pipeline = await executeCodexPipeline({
      runId,
      userId,
      userName,
      chatId,
      messages,
      contextText,
      systemPrompt,
      model: codexModel,
      tools: tools as Record<string, any>,
      workspace,
      changes,
      onProgress: (line) => sendSse(res, { type: 'progress', line }),
      onChange: (change) => sendSse(res, { type: 'change', change }),
      onEvent: (event) => {
        sendSse(res, { type: 'run_event', event });
        void appendAssistantEvent(tenantId, runId, event).catch(() => undefined);
      },
    });
    await completePipeline(pipeline);

    if (pipeline.status === 'failed') {
      sendSse(res, {
        type: 'error',
        message:
          pipeline.conflicts[0]?.message ||
          pipeline.message ||
          `Codex pipeline failed (${pipeline.finishReason || 'unknown reason'})`,
      });
    }
    sendSse(res, {
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
    userId,
    userName,
    chatId,
    messages,
    contextText,
    systemPrompt,
    model: codexModel,
    tools: tools as Record<string, any>,
    workspace,
    changes,
    onEvent: (event) => {
      void appendAssistantEvent(tenantId, runId, event).catch(() => undefined);
    },
  });
  await completePipeline(pipeline);
  if (pipeline.status === 'failed') {
    throw new Error(pipeline.conflicts[0]?.message || pipeline.message || 'Codex execution failed');
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
};

type AssistantRunParams = {
  req: NextApiRequest;
  res: NextApiResponse;
  tenantId: string;
  runId: string;
  runName: string;
  idempotency: string;
  stream: boolean;
  rawSystemPrompt: unknown;
  assistantSystemPrompt: string;
  config: unknown;
  allowClientConfig: boolean;
  tools: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
  contextText: string;
  changes: AssistantChange[];
};

export const handleAssistantRun = async ({
  req,
  res,
  tenantId,
  runId,
  runName,
  idempotency,
  stream,
  rawSystemPrompt,
  assistantSystemPrompt,
  config,
  allowClientConfig,
  tools,
  messages,
  contextText,
  changes,
}: AssistantRunParams): Promise<void> => {
  const modelConfig = await pickAvailableModel(buildAssistantModelConfig((config ?? {}) as Record<string, unknown>, allowClientConfig));
  const systemPrompt = normalizeSystemPrompt(rawSystemPrompt, assistantSystemPrompt);
  const agent = createAssistantAgent(tools as any, modelConfig);

  const finalize = async (run: Awaited<ReturnType<typeof executeAssistantRun>>) => {
    const status = run.events.some((event) => event.type === 'RUN_FAILED') ? 'failed' : 'completed';
    await completeAssistantRun({
      runId,
      tenantId,
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
    return { ...run, status };
  };

  if (stream) {
    openSse(res);
    const send = (payload: Record<string, unknown>) => sendSse(res, payload);

    try {
      let closed = false;
      req.on('close', () => {
        closed = true;
      });
      let startSent = false;
      const emitRunEvent = (event: AssistantRunEvent) => {
        if (closed) return;
        if (!startSent) {
          send({ type: 'start', runId: event.runId });
          startSent = true;
        }
        send({ type: 'run_event', event });
      };

      const run = await executeAssistantRun({
        runId,
        agent,
        messages,
        systemPrompt,
        contextText,
        maxSteps: 24,
        maxRetries: 1,
        onDelta: (content) => {
          if (!closed && content) send({ type: 'delta', content });
        },
        onEvent: (event) => {
          emitRunEvent(event);
          void appendAssistantEvent(tenantId, runId, event).catch(() => undefined);
        },
        collectChanges: () => changes,
      });

      const finalized = await finalize(run);
      send({
        type: 'done',
        message: finalized.message || '',
        changes,
        finishReason: finalized.finishReason,
        runId,
        usage: finalized.usage,
        events: finalized.events,
        dag: finalized.dag,
        conflicts: finalized.conflicts,
      });
      res.end();
      return;
    } catch (err) {
      const now = new Date().toISOString();
      await completeAssistantRun({
        runId,
        tenantId,
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
          { id: `${runId}-messages`, kind: 'request_messages', payload: messages },
          { id: `${runId}-context`, kind: 'workspace_context', payload: contextText },
          { id: `${runId}-changes`, kind: 'workspace_changes', payload: [] },
        ],
        dag: { nodes: [], edges: [] },
        conflicts: [],
      });
      send({ type: 'error', message: (err as Error).message || 'Streaming failed' });
      res.end();
      return;
    }
  }

  const run = await executeAssistantRun({
    runId,
    agent,
    messages,
    systemPrompt,
    contextText,
    maxSteps: 24,
    maxRetries: 1,
    onEvent: (event) => {
      void appendAssistantEvent(tenantId, runId, event).catch(() => undefined);
    },
    collectChanges: () => changes,
  });
  const finalized = await finalize(run);

  res.status(200).json({
    message: finalized.message || '',
    changes,
    finishReason: finalized.finishReason,
    runId,
    usage: finalized.usage,
    events: finalized.events,
    dag: finalized.dag,
    conflicts: finalized.conflicts,
  });
};
