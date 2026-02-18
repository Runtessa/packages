import type { CodexPlan, FileDirective } from './codex-types';

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

export const parseCodexPlan = (raw: string): CodexPlan | null => {
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
        return { tool, input, reason };
      })
      .filter(Boolean) as NonNullable<CodexPlan['operations']>;
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

export const parseCodexFileDirectives = (raw: string): FileDirective[] => {
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

export const formatCodexProgressLine = (
  line: string,
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
