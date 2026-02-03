import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';
import { resolveTenant } from '@/lib/tenancy';
import { buildAssistantTools } from '@/lib/assistant/tools';
import { buildAssistantModelConfig, createAssistantAgent } from '@/lib/assistant/agent';
import type { AssistantChange } from '@/lib/assistant/types';
import type { MastraModelConfig } from '@mastra/core/llm';

type ClientContext = {
  activeFile?: {
    id: string;
    name: string;
    meta?: Record<string, unknown>;
    content?: string;
  } | null;
};

const MAX_CONTEXT_CHARS = 8000;

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

const buildContextText = (
  workspace: {
    modules: Array<{ id: string; routePath: string; method: string }>;
    uiPackages: Array<{ id: string; name: string; version: string; fileExtension?: string | null }>;
    sharedUi: Array<{ id: string; name: string; version: string }>;
    sharedModules: Array<{ id: string; name: string; version: string }>;
  },
  acl: { permissions: unknown; roles: unknown; endpoints: unknown },
  clientContext?: ClientContext
) => {
  const lines: string[] = [];
  lines.push('Workspace snapshot:');
  lines.push(`Modules (${workspace.modules.length}):`);
  workspace.modules.forEach((mod) => {
    lines.push(`- ${mod.method} ${mod.routePath} (id:${mod.id})`);
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
  if (clientContext?.activeFile) {
    const active = clientContext.activeFile;
    lines.push('Active file:');
    lines.push(`- ${active.name} (id:${active.id})`);
    if (active.meta) {
      lines.push('Active file meta:');
      lines.push(truncate(JSON.stringify(active.meta, null, 2)));
    }
    if (active.content) {
      lines.push('Active file content:');
      lines.push(truncate(active.content));
    }
  }
  return lines.join('\n');
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

  const { messages, config, context, stream } = req.body ?? {};
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
    isAdmin: user.isAdmin,
    changes,
  });

  const workspace = await executeTool<{
    modules: Array<{ id: string; routePath: string; method: string }>;
    uiPackages: Array<{ id: string; name: string; version: string; fileExtension?: string | null }>;
    sharedUi: Array<{ id: string; name: string; version: string }>;
    sharedModules: Array<{ id: string; name: string; version: string }>;
  }, Record<string, never>>(tools.list_workspace, {});
  const acl = await executeTool<{
    permissions: unknown;
    roles: unknown;
    endpoints: unknown;
  }, Record<string, never>>(tools.get_acl_config, {});
  const contextText = buildContextText(
    {
      modules: workspace.modules ?? [],
      uiPackages: workspace.uiPackages ?? [],
      sharedUi: workspace.sharedUi ?? [],
      sharedModules: workspace.sharedModules ?? [],
    },
    {
      permissions: acl.permissions,
      roles: acl.roles,
      endpoints: acl.endpoints,
    },
    context as ClientContext
  );

  const modelConfig = await pickAvailableModel(
    buildAssistantModelConfig(config ?? {}, allowClientConfig)
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
      const output = await agent.stream(normalizedMessages as any, {
        system: contextText,
        maxSteps: 24,
      });

      sendEvent({ type: 'start', runId: output.runId });

      const reader = output.textStream.getReader();
      let closed = false;
      req.on('close', () => {
        closed = true;
        reader.cancel().catch(() => undefined);
      });

      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          sendEvent({ type: 'delta', content: value });
        }
      }

      const full = await output.getFullOutput();
      const usage = await output.totalUsage;
      sendEvent({
        type: 'done',
        message: full.text?.trim() || '',
        changes,
        finishReason: full.finishReason,
        runId: output.runId,
        usage,
      });
      res.end();
      return;
    } catch (err) {
      sendEvent({
        type: 'error',
        message: (err as Error).message || 'Streaming failed',
      });
      res.end();
      return;
    }
  }

  const output = await agent.generate(normalizedMessages as any, {
    system: contextText,
    maxSteps: 24,
  });

  res.status(200).json({
    message: output.text?.trim() || '',
    changes,
    finishReason: output.finishReason,
    runId: output.runId,
    usage: output.totalUsage ?? output.usage,
  });
});
