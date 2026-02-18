import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { CODEX_SYSTEM_INSTRUCTIONS } from '@/lib/assistant/codex';
import { buildAssistantTools } from '@/lib/assistant/tools';
import { ASSISTANT_SYSTEM_INSTRUCTIONS } from '@/lib/assistant/agent';
import type { AssistantChange } from '@/lib/assistant/types';
import {
  buildAssistantIdempotencyKey,
  getAssistantRunSummary,
  reserveAssistantRun,
  startAssistantRun,
} from '@/lib/assistant/state-store';
import { listPreviewExceptions } from '@/lib/assistant/preview-exceptions-store';
import {
  isCodexAgentMode,
  normalizeMessages,
  shouldWatchPreviewFromPrompt,
  resolvePreviewExceptionsLimit,
  buildContextText,
  createRunId,
  buildRunName,
  executeTool,
  type WorkspaceContext,
} from '@/lib/assistant/respond-runtime';
import {
  handleAssistantRun,
  handleCodexRun,
  tryRespondFromCachedRun,
} from '@/lib/assistant/respond-flow';

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

  const workspace = await executeTool<WorkspaceContext, Record<string, never>>(tools.list_workspace, {});
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
  const previewExceptionsLimit = resolvePreviewExceptionsLimit(context?.previewExceptionsLimit);
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
    },
  );

  const idempotency = buildAssistantIdempotencyKey(normalizedMessages, contextText);
  const runId = createRunId(chatId);
  const existingRunSummary = await getAssistantRunSummary(tenant.id, runId);
  const runName = existingRunSummary?.runName || buildRunName(normalizedMessages);
  const reservation = await reserveAssistantRun(tenant.id, runId, idempotency);

  if (reservation.reusedRunId) {
    const handled = await tryRespondFromCachedRun({
      tenantId: tenant.id,
      runId,
      reusedRunId: reservation.reusedRunId,
      stream: Boolean(stream),
      res,
      changes,
    });
    if (handled) return;
  }

  await startAssistantRun(tenant.id, runId, { idempotency, runName });

  if (isCodexAgentMode()) {
    await handleCodexRun({
      req,
      res,
      tenantId: tenant.id,
      userId: user.id,
      userName: user.email,
      chatId,
      runId,
      runName,
      idempotency,
      stream: Boolean(stream),
      rawSystemPrompt,
      config,
      allowClientConfig,
      messages: normalizedMessages,
      contextText,
      tools: tools as Record<string, unknown>,
      workspace,
      changes,
      codexSystemPrompt: CODEX_SYSTEM_INSTRUCTIONS,
    });
    return;
  }

  await handleAssistantRun({
    req,
    res,
    tenantId: tenant.id,
    runId,
    runName,
    idempotency,
    stream: Boolean(stream),
    rawSystemPrompt,
    assistantSystemPrompt: ASSISTANT_SYSTEM_INSTRUCTIONS,
    config,
    allowClientConfig,
    tools: tools as Record<string, unknown>,
    messages: normalizedMessages,
    contextText,
    changes,
  });
});
