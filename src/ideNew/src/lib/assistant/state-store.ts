import { createHash } from 'crypto';
import redis from '@/lib/redis';
import type {
  AssistantRunConflict,
  AssistantRunEdge,
  AssistantRunEvent,
  AssistantRunNode,
} from '@/lib/assistant/orchestrator';
import type { AssistantChange } from '@/lib/assistant/types';

type PersistedArtifact = {
  id: string;
  kind: string;
  payload: unknown;
};

type PersistedRunPayload = {
  runId: string;
  tenantId: string;
  runName?: string;
  status: 'completed' | 'failed';
  message: string;
  finishReason?: string;
  usage?: unknown;
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
  events: AssistantRunEvent[];
  changes?: AssistantChange[];
  artifacts: PersistedArtifact[];
  dag: {
    nodes: AssistantRunNode[];
    edges: AssistantRunEdge[];
  };
  conflicts: AssistantRunConflict[];
};

export type AssistantRunSummary = {
  runId: string;
  runName?: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
  eventsCount: number;
  changesCount: number;
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
const MAX_RUN_EVENTS = 4000;
const MAX_RUN_CHANGES = 2000;
const MAX_RUN_CONFLICTS = 1000;
const MAX_TURN_HISTORY = 500;
const TURN_HISTORY_ARTIFACT_KIND = 'turn_history';

const getChangeKey = (change: AssistantChange) => {
  if (change.kind === 'module') {
    const target = change.after ?? change.before;
    return `module:${change.action}:${target?.id || `${target?.method || ''}:${target?.routePath || ''}`}`;
  }
  if (change.kind === 'model') {
    const target = change.after ?? change.before;
    return `model:${change.action}:${target?.id || target?.path || 'unknown'}`;
  }
  if (change.kind === 'ui') {
    const target = change.after ?? change.before;
    return `ui:${change.action}:${target?.id || `${target?.name || ''}@${target?.version || ''}`}`;
  }
  if (change.kind === 'acl') {
    return `acl:${change.file}`;
  }
  if (change.kind === 'shared-project') {
    const target = change.after ?? change.before;
    return `shared-project:${change.action}:${target?.id || `${target?.name || ''}@${target?.version || ''}`}`;
  }
  const target = change.after ?? change.before;
  return `shared-file:${change.action}:${change.projectId}:${target?.id || target?.path || 'unknown'}`;
};

const mergeRunChanges = (existing: AssistantChange[], incoming: AssistantChange[]) => {
  const merged = [...existing];
  for (const change of incoming) {
    const key = getChangeKey(change);
    const index = merged.findIndex((item) => getChangeKey(item) === key);
    if (index === -1) {
      merged.push(change);
      continue;
    }
    merged[index] = change;
  }
  if (merged.length <= MAX_RUN_CHANGES) return merged;
  return merged.slice(merged.length - MAX_RUN_CHANGES);
};

const mergeRunEvents = (existing: AssistantRunEvent[], incoming: AssistantRunEvent[]) => {
  const merged = [...existing, ...incoming];
  if (merged.length <= MAX_RUN_EVENTS) return merged;
  return merged.slice(merged.length - MAX_RUN_EVENTS);
};

const mergeRunConflicts = (existing: AssistantRunConflict[], incoming: AssistantRunConflict[]) => {
  const merged = [...existing, ...incoming];
  if (merged.length <= MAX_RUN_CONFLICTS) return merged;
  return merged.slice(merged.length - MAX_RUN_CONFLICTS);
};

const readTurnHistory = (artifacts: PersistedArtifact[]) => {
  const historyArtifact = artifacts.find((item) => item.kind === TURN_HISTORY_ARTIFACT_KIND);
  if (!historyArtifact || !Array.isArray(historyArtifact.payload)) return [];
  return historyArtifact.payload as Array<Record<string, unknown>>;
};

const buildMergedArtifacts = (
  previous: PersistedArtifact[],
  next: PersistedArtifact[],
  turn: {
    at: string;
    status: string;
    finishReason?: string;
    message: string;
    changes: AssistantChange[];
    events: AssistantRunEvent[];
  }
) => {
  const previousHistory = readTurnHistory(previous);
  const mergedHistory = [...previousHistory, turn];
  const trimmedHistory =
    mergedHistory.length <= MAX_TURN_HISTORY
      ? mergedHistory
      : mergedHistory.slice(mergedHistory.length - MAX_TURN_HISTORY);
  const nextWithoutHistory = next.filter((item) => item.kind !== TURN_HISTORY_ARTIFACT_KIND);
  return [
    ...nextWithoutHistory,
    {
      id: `${Date.now()}-${TURN_HISTORY_ARTIFACT_KIND}`,
      kind: TURN_HISTORY_ARTIFACT_KIND,
      payload: trimmedHistory,
    },
  ];
};

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
  options?: { idempotency?: string; runName?: string }
) => {
  const now = new Date().toISOString();
  const key = runHashKey(tenantId, runId);
  const existing = await redis.hgetall(key);
  const createdAt = String(existing?.createdAt || now);
  const runName = String(existing?.runName || options?.runName || '');
  const existingEventsCount = Number(existing?.eventsCount || 0);
  const existingChangesCount = Number(existing?.changesCount || 0);
  const existingConflictsCount = Number(existing?.conflictsCount || 0);
  const idempotency = String(options?.idempotency || existing?.idempotencyKey || '');
  await redis.hset(runHashKey(tenantId, runId), {
    runId,
    tenantId,
    runName,
    status: 'running',
    createdAt,
    updatedAt: now,
    idempotencyKey: idempotency,
    eventsCount: String(existingEventsCount),
    changesCount: String(existingChangesCount),
    conflictsCount: String(existingConflictsCount),
    finishReason: '',
  });
  await redis.expire(key, RUN_RETENTION_SECONDS);
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
  const previous = await getAssistantRun(payload.tenantId, payload.runId);
  const merged: PersistedRunPayload = previous
    ? {
        ...payload,
        runName: previous.runName || payload.runName,
        createdAt: previous.createdAt || payload.createdAt,
        events: mergeRunEvents(previous.events ?? [], payload.events ?? []),
        changes: mergeRunChanges(previous.changes ?? [], payload.changes ?? []),
        conflicts: mergeRunConflicts(previous.conflicts ?? [], payload.conflicts ?? []),
        artifacts: buildMergedArtifacts(previous.artifacts ?? [], payload.artifacts ?? [], {
          at: payload.updatedAt,
          status: payload.status,
          finishReason: payload.finishReason,
          message: payload.message,
          changes: payload.changes ?? [],
          events: payload.events ?? [],
        }),
      }
    : payload;
  const key = runHashKey(payload.tenantId, payload.runId);
  await redis.set(
    runPayloadKey(payload.tenantId, payload.runId),
    JSON.stringify(merged),
    'EX',
    RUN_RETENTION_SECONDS
  );
  await redis.hset(key, {
    runName: merged.runName ?? '',
    status: merged.status,
    updatedAt: merged.updatedAt,
    eventsCount: String(merged.events.length),
    changesCount: String(merged.changes?.length ?? 0),
    conflictsCount: String(merged.conflicts.length),
    finishReason: merged.finishReason ?? '',
    idempotencyKey: merged.idempotencyKey ?? '',
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
    runName: data.runName || undefined,
    status: (data.status as AssistantRunSummary['status']) || 'running',
    createdAt: data.createdAt || '',
    updatedAt: data.updatedAt || '',
    idempotencyKey: data.idempotencyKey || undefined,
    eventsCount: Number(data.eventsCount || 0),
    changesCount: Number(data.changesCount || 0),
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

export const deleteAssistantRun = async (tenantId: string, runId: string) => {
  const key = runHashKey(tenantId, runId);
  const data = await redis.hgetall(key);
  const idempotency = String(data?.idempotencyKey || '').trim();
  const deletions: Promise<unknown>[] = [
    redis.del(runPayloadKey(tenantId, runId)),
    redis.del(runEventsListKey(tenantId, runId)),
    redis.del(runEventsStreamKey(tenantId, runId)),
    redis.del(key),
    redis.zrem(runsIndexKey(tenantId), runId),
  ];
  if (idempotency) {
    deletions.push(redis.del(idempotencyKey(tenantId, idempotency)));
  }
  await Promise.all(deletions);
};
