import redis from '@/lib/redis';

export type PreviewExceptionEntry = {
  id: string;
  tenantId: string;
  userId: string;
  kind: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  sourceUrl?: string;
  line?: number | null;
  column?: number | null;
  requestUrl?: string;
  method?: string;
  status?: number | null;
  responseSnippet?: string;
  previewName?: string;
  previewVersion?: string;
  previewSession?: string;
  href?: string;
  createdAt: string;
};

const MAX_ITEMS = 200;
const RETENTION_SECONDS = 7 * 24 * 60 * 60;
const MAX_TEXT = 4000;
const MAX_SNIPPET = 2000;

const previewExceptionsKey = (tenantId: string, userId: string) =>
  `assistant:preview:exceptions:${tenantId}:${String(userId)}`;

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `preview-${Math.random().toString(36).slice(2, 10)}`;
};

const asTrimmed = (value: unknown, max = MAX_TEXT) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
};

const asNullableNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const normalizeLevel = (value: unknown): 'error' | 'warn' | 'info' => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'warn' || raw === 'warning') return 'warn';
  if (raw === 'info') return 'info';
  return 'error';
};

const normalizeEntry = (
  tenantId: string,
  userId: string,
  raw: unknown
): PreviewExceptionEntry | null => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const message = asTrimmed(source.message);
  if (!message) return null;
  const createdAtRaw = asTrimmed(source.createdAt, 128);
  const createdAt = createdAtRaw || new Date().toISOString();

  return {
    id: asTrimmed(source.id, 128) || createId(),
    tenantId,
    userId,
    kind: asTrimmed(source.kind, 64) || 'runtime',
    level: normalizeLevel(source.level),
    message,
    stack: asTrimmed(source.stack),
    sourceUrl: asTrimmed(source.sourceUrl, 1024),
    line: asNullableNumber(source.line),
    column: asNullableNumber(source.column),
    requestUrl: asTrimmed(source.requestUrl, 1024),
    method: asTrimmed(source.method, 32).toUpperCase() || undefined,
    status: asNullableNumber(source.status),
    responseSnippet: asTrimmed(source.responseSnippet, MAX_SNIPPET),
    previewName: asTrimmed(source.previewName, 256),
    previewVersion: asTrimmed(source.previewVersion, 128),
    previewSession: asTrimmed(source.previewSession, 128),
    href: asTrimmed(source.href, 1024),
    createdAt,
  };
};

const parseStoredEntry = (raw: string): PreviewExceptionEntry | null => {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as PreviewExceptionEntry;
    if (!entry.message || !entry.createdAt) return null;
    return entry;
  } catch {
    return null;
  }
};

export const appendPreviewExceptions = async (
  tenantId: string,
  userId: string,
  entries: unknown[]
) => {
  const key = previewExceptionsKey(tenantId, userId);
  const normalized = entries
    .map((entry) => normalizeEntry(tenantId, String(userId), entry))
    .filter((entry): entry is PreviewExceptionEntry => Boolean(entry));

  if (!normalized.length) return 0;

  const pipeline = redis.pipeline();
  normalized.forEach((entry) => {
    pipeline.lpush(key, JSON.stringify(entry));
  });
  pipeline.ltrim(key, 0, MAX_ITEMS - 1);
  pipeline.expire(key, RETENTION_SECONDS);
  await pipeline.exec();
  return normalized.length;
};

export const listPreviewExceptions = async (
  tenantId: string,
  userId: string,
  limit = 20
) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const key = previewExceptionsKey(tenantId, userId);
  const raw = await redis.lrange(key, 0, safeLimit - 1);
  const items = raw
    .map((entry) => parseStoredEntry(entry))
    .filter((entry): entry is PreviewExceptionEntry => Boolean(entry));
  return items;
};

export const clearPreviewExceptions = async (tenantId: string, userId: string) => {
  const key = previewExceptionsKey(tenantId, userId);
  await redis.del(key);
};

