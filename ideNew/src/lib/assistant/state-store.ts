import { createHash } from 'crypto';
import redis from '@/lib/redis';
import type {
  AssistantRunConflict,
  AssistantRunEdge,
  AssistantRunEvent,
  AssistantRunNode,
} from '@/lib/assistant/orchestrator';

type PersistedArtifact = {
  id: string;
  kind: string;
  payload: unknown;
};

type PersistedRunPayload = {
  runId: string;
  tenantId: string;
  status: 'completed' | 'failed';
  message: string;
  finishReason?: string;
  usage?: unknown;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
  events: AssistantRunEvent[];
  artifacts: PersistedArtifact[];
  dag: {
    nodes: AssistantRunNode[];
    edges: AssistantRunEdge[];
  };
  conflicts: AssistantRunConflict[];
};

export type AssistantRunSummary = {
  runId: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
  eventsCount: number;
  conflictsCount: number;
  finishReason?: string;
};

const runHashKey = (tenantId: string, runId: string) =>
  `assistant:run:${tenantId}:${runId}:meta`;
const runPayloadKey = (tenantId: string, runId: string) =>
  `assistant:run:${tenantId}:${runId}:payload`;
const runEventsListKey = (tenantId: string, runId: string) =>
  `assistant:run:${tenantId}:${runId}:events`;
const runEventsStreamKey = (tenantId: string, runId: string) =>
  `assistant:run:${tenantId}:${runId}:stream`;
const tenantEventsStreamKey = (tenantId: string) => `assistant:tenant:${tenantId}:stream`;
const runsIndexKey = (tenantId: string) => `assistant:runs:${tenantId}`;
const idempotencyKey = (tenantId: string, key: string) =>
  `assistant:idempotency:${tenantId}:${key}`;

const RUN_RETENTION_SECONDS = 60 * 60 * 24 * 7;
const IDEMPOTENCY_RETENTION_SECONDS = 60 * 10;

export const buildAssistantIdempotencyKey = (messages: unknown, contextText: string) =>
  createHash('sha256')
    .update(JSON.stringify(messages))
    .update('\n')
    .update(contextText)
    .digest('hex');

export const reserveAssistantRun = async (
  tenantId: string,
  runId: string,
  idempotency: string
): Promise<{ reusedRunId?: string }> => {
  const existingRunId = await redis.get(idempotencyKey(tenantId, idempotency));
  if (existingRunId) {
    return { reusedRunId: existingRunId };
  }
  const set = await redis.set(
    idempotencyKey(tenantId, idempotency),
    runId,
    'EX',
    IDEMPOTENCY_RETENTION_SECONDS,
    'NX'
  );
  if (set !== 'OK') {
    const winner = await redis.get(idempotencyKey(tenantId, idempotency));
    if (winner) return { reusedRunId: winner };
  }
  return {};
};

export const startAssistantRun = async (
  tenantId: string,
  runId: string,
  idempotency?: string
) => {
  const now = new Date().toISOString();
  await redis.hset(runHashKey(tenantId, runId), {
    runId,
    tenantId,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    idempotencyKey: idempotency ?? '',
    eventsCount: '0',
    conflictsCount: '0',
    finishReason: '',
  });
  await redis.expire(runHashKey(tenantId, runId), RUN_RETENTION_SECONDS);
  await redis.zadd(runsIndexKey(tenantId), Date.now(), runId);
  await redis.expire(runsIndexKey(tenantId), RUN_RETENTION_SECONDS);
};

export const appendAssistantEvent = async (
  tenantId: string,
  runId: string,
  event: AssistantRunEvent
) => {
  const payload = JSON.stringify(event);
  await Promise.all([
    redis.rpush(runEventsListKey(tenantId, runId), payload),
    redis.xadd(runEventsStreamKey(tenantId, runId), '*', 'event', payload),
    redis.xadd(tenantEventsStreamKey(tenantId), '*', 'event', payload),
    redis.hincrby(runHashKey(tenantId, runId), 'eventsCount', 1),
    redis.hset(runHashKey(tenantId, runId), 'updatedAt', new Date().toISOString()),
  ]);
  await Promise.all([
    redis.expire(runEventsListKey(tenantId, runId), RUN_RETENTION_SECONDS),
    redis.expire(runEventsStreamKey(tenantId, runId), RUN_RETENTION_SECONDS),
    redis.expire(tenantEventsStreamKey(tenantId), RUN_RETENTION_SECONDS),
    redis.expire(runHashKey(tenantId, runId), RUN_RETENTION_SECONDS),
  ]);
};

export const completeAssistantRun = async (
  payload: PersistedRunPayload
) => {
  const key = runHashKey(payload.tenantId, payload.runId);
  await redis.set(runPayloadKey(payload.tenantId, payload.runId), JSON.stringify(payload), 'EX', RUN_RETENTION_SECONDS);
  await redis.hset(key, {
    status: payload.status,
    updatedAt: payload.updatedAt,
    eventsCount: String(payload.events.length),
    conflictsCount: String(payload.conflicts.length),
    finishReason: payload.finishReason ?? '',
    idempotencyKey: payload.idempotencyKey ?? '',
  });
  await redis.expire(key, RUN_RETENTION_SECONDS);
  await redis.zadd(runsIndexKey(payload.tenantId), Date.now(), payload.runId);
  await redis.expire(runsIndexKey(payload.tenantId), RUN_RETENTION_SECONDS);
};

export const getAssistantRun = async (tenantId: string, runId: string) => {
  const raw = await redis.get(runPayloadKey(tenantId, runId));
  if (!raw) return null;
  return JSON.parse(raw) as PersistedRunPayload;
};

export const getAssistantRunSummary = async (
  tenantId: string,
  runId: string
): Promise<AssistantRunSummary | null> => {
  const data = await redis.hgetall(runHashKey(tenantId, runId));
  if (!data || !Object.keys(data).length) return null;
  return {
    runId: data.runId || runId,
    status: (data.status as AssistantRunSummary['status']) || 'running',
    createdAt: data.createdAt || '',
    updatedAt: data.updatedAt || '',
    idempotencyKey: data.idempotencyKey || undefined,
    eventsCount: Number(data.eventsCount || 0),
    conflictsCount: Number(data.conflictsCount || 0),
    finishReason: data.finishReason || undefined,
  };
};

export const listAssistantRuns = async (
  tenantId: string,
  options?: { limit?: number; offset?: number }
) => {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  const offset = Math.max(0, options?.offset ?? 0);
  const ids = await redis.zrevrange(runsIndexKey(tenantId), offset, offset + limit - 1);
  if (!ids.length) return [];
  const summaries = await Promise.all(ids.map((id) => getAssistantRunSummary(tenantId, id)));
  return summaries.filter(Boolean) as AssistantRunSummary[];
};
