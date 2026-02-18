import type { MastraModelConfig } from '@mastra/core/llm';

const MAX_CONTEXT_CHARS = 240000;
const MAX_SYSTEM_PROMPT_CHARS = 120000;

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

export const pickAvailableModel = async (
  modelConfig: MastraModelConfig,
): Promise<MastraModelConfig> => {
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

export const normalizeMessages = (raw: unknown) => {
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

export const normalizeSystemPrompt = (raw: unknown, fallback: string) => {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return truncate(trimmed, MAX_SYSTEM_PROMPT_CHARS);
};

export const createRunId = (chatId?: string) => {
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

export const buildRunName = (messages: Array<{ role: string; content: string }>) => {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  const raw = firstUser?.content?.trim() || '';
  if (!raw) return 'Untitled run';
  const singleLine = raw.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 80) return singleLine;
  return `${singleLine.slice(0, 77)}...`;
};

export const shouldWatchPreviewFromPrompt = (
  messages: Array<{ role: string; content: string }>,
) => {
  const latestUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim());
  const prompt = String(latestUser?.content || '');
  return /\b(watch|monitor|check)\s+preview\b/i.test(prompt);
};

export const resolvePreviewExceptionsLimit = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
};
