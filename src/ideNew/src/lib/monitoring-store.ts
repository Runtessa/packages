import { randomUUID } from 'crypto';
import redis from '@/lib/redis';

export type MonitoringRule = {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'global' | 'instance' | 'tenant';
  tenantId?: string | null;
  metricKey: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  cooldownSec: number;
  severity: 'info' | 'warning' | 'critical';
  webhookUrl?: string | null;
  webhookMethod?: string | null;
  webhookHeaders?: Record<string, string> | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MonitoringTenantSample = {
  tenantId: string | null;
  tenantHostname: string | null;
  requestCount: number;
  errorCount: number;
  errorRatePct: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  networkInBytes: number;
  networkOutBytes: number;
};

export type MonitoringSnapshot = {
  id: string;
  createdAt: string;
  serverName: string;
  instanceId: string;
  instanceName: string;
  cpuPercent: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  memoryHeapTotalMb: number;
  storageTotalMb: number;
  storageUsedMb: number;
  storageFreeMb: number;
  storageUsedPct: number;
  threadActiveHandles: number;
  threadActiveRequests: number;
  eventLoopLagMs: number;
  networkInBytes: number;
  networkOutBytes: number;
  requestCount: number;
  errorCount: number;
  errorRatePct: number;
  tenantSamples: MonitoringTenantSample[];
};

export type MonitoringAlertEvent = {
  id: string;
  ruleId: string;
  ruleName: string;
  tenantId?: string | null;
  tenantHostname?: string | null;
  serverName: string;
  instanceId: string;
  instanceName: string;
  metricKey: string;
  metricValue: number;
  threshold: number;
  operator: string;
  severity: string;
  status: string;
  webhookStatus?: string | null;
  webhookResponse?: string | null;
  webhookTarget?: string | null;
  createdAt: string;
};

const KEY = {
  instances: 'monitoring:instances',
  rulesIds: 'monitoring:rules:ids',
  rulesData: 'monitoring:rules:data',
  alerts: 'monitoring:alerts',
  meta: (instanceKey: string) => `monitoring:instance:${instanceKey}:meta`,
  heartbeat: (instanceKey: string) => `monitoring:instance:${instanceKey}:heartbeat`,
  snapshots: (instanceKey: string) => `monitoring:snapshots:${instanceKey}`,
};

const parseJson = <T>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const normalizeSnapshot = (snapshot: MonitoringSnapshot): MonitoringSnapshot => ({
  ...snapshot,
  instanceName: snapshot.instanceName || snapshot.instanceId,
});

const normalizeAlert = (event: MonitoringAlertEvent): MonitoringAlertEvent => ({
  ...event,
  instanceName: event.instanceName || event.instanceId,
});

export const monitoringStore = {
  keys: KEY,

  async listInstanceKeys() {
    const keys = await redis.smembers(KEY.instances);
    if (!keys.length) return [] as string[];

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.exists(KEY.heartbeat(key)));
    const result = await pipeline.exec();

    const activeKeys: string[] = [];
    const staleKeys: string[] = [];

    result?.forEach((entry, idx) => {
      const raw = entry?.[1];
      const exists = Number(raw) > 0;
      const key = keys[idx];
      if (!key) return;
      if (exists) {
        activeKeys.push(key);
      } else {
        staleKeys.push(key);
      }
    });

    if (staleKeys.length) {
      await redis.srem(KEY.instances, ...staleKeys);
    }

    return activeKeys;
  },

  async readSnapshots(instanceKey: string, limit: number) {
    const raw = await redis.lrange(KEY.snapshots(instanceKey), 0, Math.max(limit - 1, 0));
    return raw
      .map((item) => parseJson<MonitoringSnapshot>(item))
      .filter((item): item is MonitoringSnapshot => Boolean(item))
      .map(normalizeSnapshot);
  },

  async readAlerts(limit = 5000) {
    const raw = await redis.lrange(KEY.alerts, 0, Math.max(limit - 1, 0));
    return raw
      .map((item) => parseJson<MonitoringAlertEvent>(item))
      .filter((item): item is MonitoringAlertEvent => Boolean(item))
      .map(normalizeAlert);
  },

  async ingestSnapshot(snapshot: MonitoringSnapshot, retention = 21600) {
    const instanceKey = `${snapshot.serverName}::${snapshot.instanceId}`;
    const ttlSec = 30;
    await redis
      .multi()
      .sadd(KEY.instances, instanceKey)
      .set(
        KEY.meta(instanceKey),
        JSON.stringify({
          serverName: snapshot.serverName,
          instanceId: snapshot.instanceId,
          instanceName: snapshot.instanceName,
          updatedAt: snapshot.createdAt,
        })
      )
      .set(KEY.heartbeat(instanceKey), String(Date.now()), 'EX', ttlSec)
      .lpush(KEY.snapshots(instanceKey), JSON.stringify(snapshot))
      .ltrim(KEY.snapshots(instanceKey), 0, Math.max(retention - 1, 0))
      .exec();
  },

  async ingestAlert(event: MonitoringAlertEvent, retention = 5000) {
    await redis
      .multi()
      .lpush(KEY.alerts, JSON.stringify(event))
      .ltrim(KEY.alerts, 0, Math.max(retention - 1, 0))
      .exec();
  },

  async readRules() {
    const ids = await redis.smembers(KEY.rulesIds);
    if (!ids.length) return [] as MonitoringRule[];

    const pipe = redis.pipeline();
    ids.forEach((id) => pipe.hget(KEY.rulesData, id));
    const result = await pipe.exec();

    const rules: MonitoringRule[] = [];
    result?.forEach((entry, idx) => {
      if (!entry || entry[0]) return;
      const parsed = parseJson<MonitoringRule>(entry[1] as string | null);
      if (parsed?.id) {
        rules.push(parsed);
      } else if (ids[idx]) {
        void redis.hdel(KEY.rulesData, ids[idx]);
      }
    });

    return rules;
  },

  async createRule(input: Omit<MonitoringRule, 'id' | 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString();
    const rule: MonitoringRule = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    await redis
      .multi()
      .sadd(KEY.rulesIds, rule.id)
      .hset(KEY.rulesData, rule.id, JSON.stringify(rule))
      .exec();

    return rule;
  },

  async updateRule(id: string, input: Omit<MonitoringRule, 'id' | 'createdAt' | 'updatedAt'>) {
    const existingRaw = await redis.hget(KEY.rulesData, id);
    const existing = parseJson<MonitoringRule>(existingRaw);
    if (!existing) return null;

    const updated: MonitoringRule = {
      ...existing,
      ...input,
      id,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await redis
      .multi()
      .sadd(KEY.rulesIds, id)
      .hset(KEY.rulesData, id, JSON.stringify(updated))
      .exec();

    return updated;
  },

  async deleteRule(id: string) {
    const exists = await redis.hexists(KEY.rulesData, id);
    if (!exists) return false;

    await redis
      .multi()
      .hdel(KEY.rulesData, id)
      .srem(KEY.rulesIds, id)
      .exec();

    return true;
  },
};
