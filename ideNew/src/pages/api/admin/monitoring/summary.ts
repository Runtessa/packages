import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import { monitoringStore } from '@/lib/monitoring-store';

const toNumber = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toMinutes = (value: unknown) => {
  const parsed = toNumber(Array.isArray(value) ? value[0] : value, 60);
  return Math.min(Math.max(Math.floor(parsed), 5), 24 * 60);
};

const toLimit = (value: unknown, fallback: number, max: number) => {
  const parsed = toNumber(Array.isArray(value) ? value[0] : value, fallback);
  return Math.min(Math.max(Math.floor(parsed), 1), max);
};

const str = (value: unknown) => {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
};

type TenantAgg = {
  tenantId: string | null;
  tenantHostname: string | null;
  requestCount: number;
  errorCount: number;
  latencyWeightedSum: number;
  latencyWeight: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  networkInBytes: number;
  networkOutBytes: number;
};

type InstancePoint = {
  createdAt: string;
  cpuPercent: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  networkInBytes: number;
  networkOutBytes: number;
  threadActiveHandles: number;
  threadActiveRequests: number;
  storageUsedPct: number;
  errorRatePct: number;
};

type TenantPoint = {
  createdAt: string;
  requestCount: number;
  errorCount: number;
  errorRatePct: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  networkInBytes: number;
  networkOutBytes: number;
};

const normalizeTenantHostname = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);

  const minutes = toMinutes(req.query.minutes);
  const sampleIntervalSec = 4;
  const defaultPointLimit = Math.max(Math.ceil((minutes * 60) / sampleIntervalSec), 360);
  const pointLimit = toLimit(req.query.pointLimit, defaultPointLimit, 30000);
  const alertLimit = toLimit(req.query.alertLimit, 50, 500);
  const serverName = str(req.query.serverName).trim();
  const instanceId = str(req.query.instanceId).trim();
  const tenantId = str(req.query.tenantId).trim();
  const sinceTs = Date.now() - minutes * 60_000;

  const instanceKeys = await monitoringStore.listInstanceKeys();
  const fetchPerInstance = Math.min(Math.max(pointLimit, 100), 30000);

  const snapshotsByInstance = await Promise.all(
    instanceKeys.map(async (key) => ({ key, rows: await monitoringStore.readSnapshots(key, fetchPerInstance) }))
  );

  const filteredSnapshots = snapshotsByInstance
    .flatMap(({ rows }) => rows)
    .filter((snapshot) => {
      const ts = new Date(snapshot.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < sinceTs) return false;
      if (serverName && snapshot.serverName !== serverName) return false;
      if (instanceId && snapshot.instanceId !== instanceId) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const snapshots =
    filteredSnapshots.length > pointLimit
      ? filteredSnapshots.slice(filteredSnapshots.length - pointLimit)
      : filteredSnapshots;

  const latestSnapshot = snapshots[snapshots.length - 1] || null;

  const latestByInstance = new Map<string, (typeof snapshots)[number]>();
  snapshots.forEach((snapshot) => {
    latestByInstance.set(`${snapshot.serverName}::${snapshot.instanceId}`, snapshot);
  });

  const instances = Array.from(latestByInstance.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((snapshot) => ({
      serverName: snapshot.serverName,
      instanceId: snapshot.instanceId,
      instanceName: snapshot.instanceName || snapshot.instanceId,
      cpuPercent: snapshot.cpuPercent,
      memoryRssMb: snapshot.memoryRssMb,
      memoryHeapUsedMb: snapshot.memoryHeapUsedMb,
      threadActiveHandles: snapshot.threadActiveHandles,
      threadActiveRequests: snapshot.threadActiveRequests,
      networkInBytes: snapshot.networkInBytes,
      networkOutBytes: snapshot.networkOutBytes,
      storageUsedPct: snapshot.storageUsedPct,
      errorRatePct: snapshot.errorRatePct,
      createdAt: snapshot.createdAt,
    }));

  const serverMap = new Map<
    string,
    {
      serverName: string;
      instanceCount: number;
      latestAt: string;
      avgCpuPercent: number;
      avgMemoryRssMb: number;
      avgStorageUsedPct: number;
      avgErrorRatePct: number;
    }
  >();

  instances.forEach((instance) => {
    const existing = serverMap.get(instance.serverName);
    if (!existing) {
      serverMap.set(instance.serverName, {
        serverName: instance.serverName,
        instanceCount: 1,
        latestAt: instance.createdAt,
        avgCpuPercent: instance.cpuPercent,
        avgMemoryRssMb: instance.memoryRssMb,
        avgStorageUsedPct: instance.storageUsedPct,
        avgErrorRatePct: instance.errorRatePct,
      });
      return;
    }

    existing.instanceCount += 1;
    if (new Date(instance.createdAt).getTime() > new Date(existing.latestAt).getTime()) {
      existing.latestAt = instance.createdAt;
    }
    existing.avgCpuPercent += instance.cpuPercent;
    existing.avgMemoryRssMb += instance.memoryRssMb;
    existing.avgStorageUsedPct += instance.storageUsedPct;
    existing.avgErrorRatePct += instance.errorRatePct;
  });

  const servers = Array.from(serverMap.values()).map((server) => ({
    ...server,
    avgCpuPercent: server.instanceCount ? server.avgCpuPercent / server.instanceCount : 0,
    avgMemoryRssMb: server.instanceCount ? server.avgMemoryRssMb / server.instanceCount : 0,
    avgStorageUsedPct: server.instanceCount ? server.avgStorageUsedPct / server.instanceCount : 0,
    avgErrorRatePct: server.instanceCount ? server.avgErrorRatePct / server.instanceCount : 0,
  }));

  // Build a host->tenantId map so host-only samples are merged into tenant-id groups.
  const tenantHostToId = new Map<string, string>();
  snapshots.forEach((snapshot) => {
    (snapshot.tenantSamples || []).forEach((sample) => {
      const sampleTenantId =
        typeof sample.tenantId === 'string' && sample.tenantId.trim() ? sample.tenantId.trim() : '';
      const sampleTenantHost = normalizeTenantHostname(sample.tenantHostname);
      if (sampleTenantId && sampleTenantHost && !tenantHostToId.has(sampleTenantHost)) {
        tenantHostToId.set(sampleTenantHost, sampleTenantId);
      }
    });
  });

  const resolveTenantIdentity = (sample: {
    tenantId: string | null;
    tenantHostname: string | null;
  }) => {
    const sampleTenantHost = normalizeTenantHostname(sample.tenantHostname);
    const explicitTenantId =
      typeof sample.tenantId === 'string' && sample.tenantId.trim() ? sample.tenantId.trim() : null;
    const resolvedTenantId = explicitTenantId || (sampleTenantHost ? tenantHostToId.get(sampleTenantHost) || null : null);
    const key = resolvedTenantId ? `id:${resolvedTenantId}` : `host:${sampleTenantHost || 'unknown'}`;
    return {
      key,
      tenantId: resolvedTenantId,
      tenantHostname: sampleTenantHost || null,
    };
  };

  const tenantMap = new Map<string, TenantAgg>();
  snapshots.forEach((snapshot) => {
    (snapshot.tenantSamples || []).forEach((sample) => {
      const identity = resolveTenantIdentity(sample);
      if (tenantId && identity.tenantId !== tenantId) return;
      const key = identity.key;
      const existing = tenantMap.get(key);
      if (!existing) {
        tenantMap.set(key, {
          tenantId: identity.tenantId,
          tenantHostname: identity.tenantHostname,
          requestCount: sample.requestCount || 0,
          errorCount: sample.errorCount || 0,
          latencyWeightedSum: (sample.avgLatencyMs || 0) * Math.max(sample.requestCount || 0, 1),
          latencyWeight: Math.max(sample.requestCount || 0, 1),
          p95LatencyMs: sample.p95LatencyMs || 0,
          maxLatencyMs: sample.maxLatencyMs || 0,
          networkInBytes: sample.networkInBytes || 0,
          networkOutBytes: sample.networkOutBytes || 0,
        });
        return;
      }

      existing.requestCount += sample.requestCount || 0;
      existing.errorCount += sample.errorCount || 0;
      existing.latencyWeightedSum += (sample.avgLatencyMs || 0) * Math.max(sample.requestCount || 0, 1);
      existing.latencyWeight += Math.max(sample.requestCount || 0, 1);
      existing.p95LatencyMs = Math.max(existing.p95LatencyMs, sample.p95LatencyMs || 0);
      existing.maxLatencyMs = Math.max(existing.maxLatencyMs, sample.maxLatencyMs || 0);
      existing.networkInBytes += sample.networkInBytes || 0;
      existing.networkOutBytes += sample.networkOutBytes || 0;
    });
  });

  const tenants = Array.from(tenantMap.values())
    .map((row) => {
      const requestCount = row.requestCount;
      const errorCount = row.errorCount;
      return {
        tenantId: row.tenantId,
        tenantHostname: row.tenantHostname,
        requestCount,
        errorCount,
        errorRatePct: requestCount > 0 ? (errorCount / requestCount) * 100 : 0,
        avgLatencyMs: row.latencyWeight > 0 ? row.latencyWeightedSum / row.latencyWeight : 0,
        p95LatencyMs: row.p95LatencyMs,
        maxLatencyMs: row.maxLatencyMs,
        networkInBytes: row.networkInBytes,
        networkOutBytes: row.networkOutBytes,
      };
    })
    .sort((a, b) => b.requestCount - a.requestCount);

  const allAlerts = await monitoringStore.readAlerts(5000);
  const alertsInWindow = allAlerts
    .filter((event) => {
      const ts = new Date(event.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < sinceTs) return false;
      if (serverName && event.serverName !== serverName) return false;
      if (instanceId && event.instanceId !== instanceId) return false;
      if (tenantId && event.tenantId !== tenantId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const rules = await monitoringStore.readRules();
  const enabledRuleCount = rules.filter((rule) => rule.enabled).length;

  const points = snapshots.map((snapshot) => ({
    createdAt: snapshot.createdAt,
    cpuPercent: snapshot.cpuPercent,
    memoryRssMb: snapshot.memoryRssMb,
    memoryHeapUsedMb: snapshot.memoryHeapUsedMb,
    networkInBytes: snapshot.networkInBytes,
    networkOutBytes: snapshot.networkOutBytes,
    threadActiveHandles: snapshot.threadActiveHandles,
    threadActiveRequests: snapshot.threadActiveRequests,
    storageUsedPct: snapshot.storageUsedPct,
    errorRatePct: snapshot.errorRatePct,
  }));

  const instanceSeriesMap = new Map<
    string,
    {
      key: string;
      serverName: string;
      instanceId: string;
      instanceName: string;
      points: InstancePoint[];
    }
  >();

  snapshots.forEach((snapshot) => {
    const key = `${snapshot.serverName}::${snapshot.instanceId}`;
    const existing = instanceSeriesMap.get(key);
    const point: InstancePoint = {
      createdAt: snapshot.createdAt,
      cpuPercent: snapshot.cpuPercent,
      memoryRssMb: snapshot.memoryRssMb,
      memoryHeapUsedMb: snapshot.memoryHeapUsedMb,
      networkInBytes: snapshot.networkInBytes,
      networkOutBytes: snapshot.networkOutBytes,
      threadActiveHandles: snapshot.threadActiveHandles,
      threadActiveRequests: snapshot.threadActiveRequests,
      storageUsedPct: snapshot.storageUsedPct,
      errorRatePct: snapshot.errorRatePct,
    };
    if (!existing) {
      instanceSeriesMap.set(key, {
        key,
        serverName: snapshot.serverName,
        instanceId: snapshot.instanceId,
        instanceName: snapshot.instanceName || snapshot.instanceId,
        points: [point],
      });
      return;
    }
    existing.points.push(point);
  });

  const tenantSeriesMap = new Map<
    string,
    {
      key: string;
      tenantId: string | null;
      tenantHostname: string | null;
      points: TenantPoint[];
    }
  >();

  snapshots.forEach((snapshot) => {
    (snapshot.tenantSamples || []).forEach((sample) => {
      const identity = resolveTenantIdentity(sample);
      if (tenantId && identity.tenantId !== tenantId) return;
      const key = identity.key;
      const point: TenantPoint = {
        createdAt: snapshot.createdAt,
        requestCount: sample.requestCount || 0,
        errorCount: sample.errorCount || 0,
        errorRatePct: sample.errorRatePct || 0,
        avgLatencyMs: sample.avgLatencyMs || 0,
        p95LatencyMs: sample.p95LatencyMs || 0,
        maxLatencyMs: sample.maxLatencyMs || 0,
        networkInBytes: sample.networkInBytes || 0,
        networkOutBytes: sample.networkOutBytes || 0,
      };
      const existing = tenantSeriesMap.get(key);
      if (!existing) {
        tenantSeriesMap.set(key, {
          key,
          tenantId: identity.tenantId,
          tenantHostname: identity.tenantHostname,
          points: [point],
        });
        return;
      }
      existing.points.push(point);
    });
  });

  const instanceSeries = Array.from(instanceSeriesMap.values()).map((series) => ({
    ...series,
    points: series.points.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
  }));

  const tenantSeries = Array.from(tenantSeriesMap.values())
    .map((series) => ({
      ...series,
      points: series.points.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    }))
    .sort((a, b) => (b.points.reduce((sum, p) => sum + p.requestCount, 0) - a.points.reduce((sum, p) => sum + p.requestCount, 0)));

  res.status(200).json({
    window: {
      minutes,
      since: new Date(sinceTs).toISOString(),
      pointLimit,
      alertLimit,
    },
    latestSnapshot,
    points,
    servers,
    instances,
    tenants,
    instanceSeries,
    tenantSeries,
    alerts: {
      totalInWindow: alertsInWindow.length,
      recent: alertsInWindow.slice(0, alertLimit),
      enabledRuleCount,
    },
  });
});
