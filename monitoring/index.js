const { randomUUID } = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const Redis = require('ioredis');
const selfsigned = require('selfsigned');
const pkg = require('./package.json');

const KEY = {
  instances: 'monitoring:instances',
  rulesIds: 'monitoring:rules:ids',
  rulesData: 'monitoring:rules:data',
  meta: (instanceKey) => `monitoring:instance:${instanceKey}:meta`,
  heartbeat: (instanceKey) => `monitoring:instance:${instanceKey}:heartbeat`,
  snapshots: (instanceKey) => `monitoring:snapshots:${instanceKey}`,
  alerts: 'monitoring:alerts',
};

const DEFAULT_SNAPSHOT_RETENTION = 21600;
const DEFAULT_ALERT_RETENTION = 5000;
const DEFAULT_INSTANCE_TTL_SEC = 30;
const DEFAULT_TLS_REQUIRED = true;

const MONITORING_SCOPE_OPTIONS = ['global', 'instance', 'tenant'];
const MONITORING_OPERATOR_OPTIONS = ['gt', 'gte', 'lt', 'lte'];
const MONITORING_SEVERITY_OPTIONS = ['info', 'warning', 'critical'];
const MONITORING_METRIC_OPTIONS = [
  { value: 'cpu_percent', scope: 'global' },
  { value: 'memory_rss_mb', scope: 'global' },
  { value: 'memory_heap_used_mb', scope: 'global' },
  { value: 'event_loop_lag_ms', scope: 'global' },
  { value: 'error_rate_pct', scope: 'global' },
  { value: 'storage_used_pct', scope: 'global' },
  { value: 'thread_active_handles', scope: 'global' },
  { value: 'thread_active_requests', scope: 'global' },
  { value: 'network_in_bytes', scope: 'global' },
  { value: 'network_out_bytes', scope: 'global' },
  { value: 'tenant_request_count', scope: 'tenant' },
  { value: 'tenant_error_rate_pct', scope: 'tenant' },
  { value: 'tenant_avg_latency_ms', scope: 'tenant' },
  { value: 'tenant_p95_latency_ms', scope: 'tenant' },
  { value: 'tenant_max_latency_ms', scope: 'tenant' },
  { value: 'tenant_network_in_bytes', scope: 'tenant' },
  { value: 'tenant_network_out_bytes', scope: 'tenant' },
];

const app = express();
app.use(express.json({ limit: process.env.MONITORING_PAYLOAD_LIMIT || '2mb' }));

const redisUrl = process.env.CACHE_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  console.error(`[monitoring] redis error: ${err.message}`);
});

const asBearer = (header) => {
  if (!header || typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const expectedToken = () =>
  (process.env.MONITORING_INGEST_TOKEN || process.env.MONITORING_SERVER_TOKEN || '').trim();

const asBool = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseIntBounded = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
};

const normalizeInstanceName = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const isObject = (value) => Boolean(value) && typeof value === 'object';

const isValidSnapshot = (value) => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.serverName === 'string' &&
    typeof value.instanceId === 'string' &&
    Array.isArray(value.tenantSamples)
  );
};

const isValidAlert = (value) => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.serverName === 'string' &&
    typeof value.instanceId === 'string' &&
    typeof value.metricKey === 'string'
  );
};

const normalizeSnapshot = (snapshot) => ({
  ...snapshot,
  instanceName: normalizeInstanceName(snapshot.instanceName, snapshot.instanceId),
});

const normalizeAlert = (alert) => ({
  ...alert,
  instanceName: normalizeInstanceName(alert.instanceName, alert.instanceId),
});

const parseJson = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toMinutes = (value) => {
  const parsed = toNumber(Array.isArray(value) ? value[0] : value, 60);
  return Math.min(Math.max(Math.floor(parsed), 5), 24 * 60);
};

const toLimit = (value, fallback, max) => {
  const parsed = toNumber(Array.isArray(value) ? value[0] : value, fallback);
  return Math.min(Math.max(Math.floor(parsed), 1), max);
};

const toPage = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  return Math.max(Math.floor(toNumber(raw, 1)), 1);
};

const str = (value) => {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
};

const normalizeTenantHostname = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const isMonitoringScope = (value) => MONITORING_SCOPE_OPTIONS.includes(value);
const isMonitoringOperator = (value) => MONITORING_OPERATOR_OPTIONS.includes(value);
const isMonitoringSeverity = (value) => MONITORING_SEVERITY_OPTIONS.includes(value);
const isMonitoringMetric = (value) =>
  MONITORING_METRIC_OPTIONS.some((item) => item.value === value);

const parseHeaders = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k), String(v)]));
  }
  return null;
};

const ingestSnapshot = async (snapshot, retention, ttlSec) => {
  const instanceKey = `${snapshot.serverName}::${snapshot.instanceId}`;
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
};

const ingestAlert = async (alert, retention) => {
  await redis
    .multi()
    .lpush(KEY.alerts, JSON.stringify(alert))
    .ltrim(KEY.alerts, 0, Math.max(retention - 1, 0))
    .exec();
};

const listInstanceKeys = async () => {
  const keys = await redis.smembers(KEY.instances);
  if (!keys.length) return [];

  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.exists(KEY.heartbeat(key)));
  const result = await pipeline.exec();

  const activeKeys = [];
  const staleKeys = [];
  result?.forEach((entry, idx) => {
    const raw = entry?.[1];
    const exists = Number(raw) > 0;
    const key = keys[idx];
    if (!key) return;
    if (exists) activeKeys.push(key);
    else staleKeys.push(key);
  });

  if (staleKeys.length) {
    await redis.srem(KEY.instances, ...staleKeys);
  }

  return activeKeys;
};

const readSnapshots = async (instanceKey, limit) => {
  const raw = await redis.lrange(KEY.snapshots(instanceKey), 0, Math.max(limit - 1, 0));
  return raw
    .map((item) => parseJson(item))
    .filter((item) => isValidSnapshot(item))
    .map((item) => normalizeSnapshot(item));
};

const readAlerts = async (limit = 5000) => {
  const raw = await redis.lrange(KEY.alerts, 0, Math.max(limit - 1, 0));
  return raw
    .map((item) => parseJson(item))
    .filter((item) => isValidAlert(item))
    .map((item) => normalizeAlert(item));
};

const readRules = async () => {
  const ids = await redis.smembers(KEY.rulesIds);
  if (!ids.length) return [];

  const pipe = redis.pipeline();
  ids.forEach((id) => pipe.hget(KEY.rulesData, id));
  const result = await pipe.exec();

  const rules = [];
  result?.forEach((entry, idx) => {
    if (!entry || entry[0]) return;
    const parsed = parseJson(entry[1]);
    if (parsed?.id) rules.push(parsed);
    else if (ids[idx]) void redis.hdel(KEY.rulesData, ids[idx]);
  });

  return rules;
};

const createRule = async (input) => {
  const now = new Date().toISOString();
  const rule = {
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
};

const updateRule = async (id, input) => {
  const existingRaw = await redis.hget(KEY.rulesData, id);
  const existing = parseJson(existingRaw);
  if (!existing) return null;

  const updated = {
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
};

const deleteRule = async (id) => {
  const exists = await redis.hexists(KEY.rulesData, id);
  if (!exists) return false;

  await redis
    .multi()
    .hdel(KEY.rulesData, id)
    .srem(KEY.rulesIds, id)
    .exec();

  return true;
};

const requireAuth = (req, res) => {
  const token = expectedToken();
  if (!token) return true;
  const provided = asBearer(req.headers.authorization);
  if (provided && provided === token) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
};

const readTlsFile = (filePath, label) => {
  const resolved = resolveTlsPath(filePath);
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    throw new Error(`Failed to read ${label} at ${resolved}: ${error.message}`);
  }
};

const resolveTlsPath = (filePath) =>
  path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath);

const ensureSelfSignedCerts = (keyPath, certPath) => {
  const resolvedKeyPath = resolveTlsPath(keyPath);
  const resolvedCertPath = resolveTlsPath(certPath);
  const hasKey = fs.existsSync(resolvedKeyPath);
  const hasCert = fs.existsSync(resolvedCertPath);
  if (hasKey && hasCert) return;

  fs.mkdirSync(path.dirname(resolvedKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedCertPath), { recursive: true });

  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  const hostName = (process.env.MONITORING_HOST || '').trim();
  if (hostName && hostName !== '0.0.0.0' && hostName !== '127.0.0.1' && hostName !== '::') {
    altNames.push({ type: 2, value: hostName });
  }

  const attrs = [{ name: 'commonName', value: process.env.MONITORING_TLS_CN || 'localhost' }];
  const cert = selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    days: parseIntBounded(process.env.MONITORING_TLS_SELF_SIGNED_DAYS, 825, 1, 3650),
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  fs.writeFileSync(resolvedKeyPath, cert.private, { mode: 0o600 });
  fs.writeFileSync(resolvedCertPath, cert.cert, { mode: 0o644 });

  console.log(
    `[monitoring] generated self-signed TLS certificate at ${resolvedCertPath} (key: ${resolvedKeyPath})`
  );
};

const createIngressServer = () => {
  const tlsRequired = asBool(process.env.MONITORING_TLS_REQUIRED, DEFAULT_TLS_REQUIRED);
  const tlsEnabled = asBool(process.env.MONITORING_TLS_ENABLED, true);
  const autoSelfSigned = asBool(process.env.MONITORING_TLS_AUTO_SELF_SIGNED, true);
  const keyPath = process.env.MONITORING_TLS_KEY_PATH || './certs/server.key';
  const certPath = process.env.MONITORING_TLS_CERT_PATH || './certs/server.crt';
  const caPath = process.env.MONITORING_TLS_CA_PATH || '';

  if (!tlsEnabled) {
    if (tlsRequired) {
      throw new Error('TLS is required but MONITORING_TLS_ENABLED is false');
    }
    return { server: http.createServer(app), protocol: 'http' };
  }

  if (autoSelfSigned) {
    ensureSelfSignedCerts(keyPath, certPath);
  } else if (!fs.existsSync(resolveTlsPath(keyPath)) || !fs.existsSync(resolveTlsPath(certPath))) {
    throw new Error(
      'TLS cert/key not found. Set MONITORING_TLS_KEY_PATH and MONITORING_TLS_CERT_PATH or enable MONITORING_TLS_AUTO_SELF_SIGNED'
    );
  }

  const mtlsEnabled = asBool(process.env.MONITORING_TLS_MUTUAL, false);
  const options = {
    key: readTlsFile(keyPath, 'TLS key'),
    cert: readTlsFile(certPath, 'TLS certificate'),
    requestCert: mtlsEnabled,
    rejectUnauthorized: mtlsEnabled,
  };

  if (caPath) {
    options.ca = readTlsFile(caPath, 'TLS CA certificate');
  }

  return { server: https.createServer(options, app), protocol: 'https' };
};

const ingestHandler = async (req, res) => {
  if (!requireAuth(req, res)) return;

  const payload = isObject(req.body) ? req.body : {};
  const snapshots = [
    payload.snapshot,
    ...(Array.isArray(payload.snapshots) ? payload.snapshots : []),
  ]
    .filter(isValidSnapshot)
    .map(normalizeSnapshot);

  const alerts = [payload.alert, ...(Array.isArray(payload.alerts) ? payload.alerts : [])]
    .filter(isValidAlert)
    .map(normalizeAlert);

  if (!snapshots.length && !alerts.length) {
    res.status(400).json({ error: 'No valid snapshot or alert payloads' });
    return;
  }

  const snapshotRetention = parseIntBounded(
    payload.snapshotRetention,
    DEFAULT_SNAPSHOT_RETENTION,
    100,
    30000
  );
  const alertRetention = parseIntBounded(
    payload.alertRetention,
    DEFAULT_ALERT_RETENTION,
    100,
    50000
  );
  const heartbeatTtlSec = parseIntBounded(
    process.env.MONITORING_INSTANCE_TTL_SEC,
    DEFAULT_INSTANCE_TTL_SEC,
    10,
    300
  );

  await Promise.all([
    ...snapshots.map((snapshot) => ingestSnapshot(snapshot, snapshotRetention, heartbeatTtlSec)),
    ...alerts.map((alert) => ingestAlert(alert, alertRetention)),
  ]);

  res.status(200).json({
    ok: true,
    ingested: {
      snapshots: snapshots.length,
      alerts: alerts.length,
    },
  });
};

const serializeRule = (rule) => ({
  id: rule.id,
  name: rule.name,
  enabled: Boolean(rule.enabled),
  scope: rule.scope,
  tenantId: rule.tenantId || null,
  metricKey: rule.metricKey,
  operator: rule.operator,
  threshold: Number(rule.threshold) || 0,
  cooldownSec: Number(rule.cooldownSec) || 0,
  severity: rule.severity,
  webhookUrl: rule.webhookUrl || null,
  webhookMethod: rule.webhookMethod || 'POST',
  webhookHeaders: rule.webhookHeaders || null,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

const normalizeRulePayload = (body) => {
  const name = str(body?.name).trim();
  if (!name) {
    const err = new Error('Rule name is required');
    err.statusCode = 400;
    throw err;
  }

  const scopeRaw = str(body?.scope).trim() || 'global';
  if (!isMonitoringScope(scopeRaw)) {
    const err = new Error('Invalid scope');
    err.statusCode = 400;
    throw err;
  }

  const metricKeyRaw = str(body?.metricKey).trim();
  if (!isMonitoringMetric(metricKeyRaw)) {
    const err = new Error('Invalid metric key');
    err.statusCode = 400;
    throw err;
  }

  const metric = MONITORING_METRIC_OPTIONS.find((item) => item.value === metricKeyRaw);
  if (!metric) {
    const err = new Error('Invalid metric key');
    err.statusCode = 400;
    throw err;
  }

  const scope = scopeRaw;
  if (metric.scope === 'tenant' && scope !== 'tenant') {
    const err = new Error('Tenant metrics require tenant scope');
    err.statusCode = 400;
    throw err;
  }

  const operatorRaw = str(body?.operator).trim() || 'gte';
  if (!isMonitoringOperator(operatorRaw)) {
    const err = new Error('Invalid operator');
    err.statusCode = 400;
    throw err;
  }

  const severityRaw = str(body?.severity).trim() || 'warning';
  if (!isMonitoringSeverity(severityRaw)) {
    const err = new Error('Invalid severity');
    err.statusCode = 400;
    throw err;
  }

  const threshold = Number(body?.threshold);
  if (!Number.isFinite(threshold)) {
    const err = new Error('Threshold must be numeric');
    err.statusCode = 400;
    throw err;
  }

  const cooldownSec = Number(body?.cooldownSec);
  const enabledRaw = body?.enabled;
  const enabled =
    typeof enabledRaw === 'boolean'
      ? enabledRaw
      : typeof enabledRaw === 'string'
      ? enabledRaw !== 'false'
      : true;

  const webhookUrl = str(body?.webhookUrl).trim() || null;
  const webhookMethod = (str(body?.webhookMethod).trim() || 'POST').toUpperCase();
  const webhookHeaders = parseHeaders(body?.webhookHeaders);
  const tenantId = str(body?.tenantId).trim() || null;

  return {
    name,
    enabled,
    scope,
    tenantId: scope === 'tenant' ? tenantId : null,
    metricKey: metricKeyRaw,
    operator: operatorRaw,
    threshold,
    cooldownSec: Number.isFinite(cooldownSec) ? Math.max(Math.floor(cooldownSec), 0) : 300,
    severity: severityRaw,
    webhookUrl,
    webhookMethod,
    webhookHeaders,
  };
};

const summaryHandler = async (req, res) => {
  if (!requireAuth(req, res)) return;

  const minutes = toMinutes(req.query.minutes);
  const sampleIntervalSec = 4;
  const defaultPointLimit = Math.max(Math.ceil((minutes * 60) / sampleIntervalSec), 360);
  const pointLimit = toLimit(req.query.pointLimit, defaultPointLimit, 30000);
  const alertLimit = toLimit(req.query.alertLimit, 50, 500);
  const serverName = str(req.query.serverName).trim();
  const instanceId = str(req.query.instanceId).trim();
  const tenantId = str(req.query.tenantId).trim();
  const sinceTs = Date.now() - minutes * 60_000;

  const instanceKeys = await listInstanceKeys();
  const fetchPerInstance = Math.min(Math.max(pointLimit, 100), 30000);
  const snapshotsByInstance = await Promise.all(
    instanceKeys.map(async (key) => ({ key, rows: await readSnapshots(key, fetchPerInstance) }))
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

  const latestByInstance = new Map();
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

  const serverMap = new Map();
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

  const tenantHostToId = new Map();
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

  const resolveTenantIdentity = (sample) => {
    const sampleTenantHost = normalizeTenantHostname(sample.tenantHostname);
    const explicitTenantId =
      typeof sample.tenantId === 'string' && sample.tenantId.trim() ? sample.tenantId.trim() : null;
    const resolvedTenantId =
      explicitTenantId || (sampleTenantHost ? tenantHostToId.get(sampleTenantHost) || null : null);
    const key = resolvedTenantId ? `id:${resolvedTenantId}` : `host:${sampleTenantHost || 'unknown'}`;
    return {
      key,
      tenantId: resolvedTenantId,
      tenantHostname: sampleTenantHost || null,
    };
  };

  const tenantMap = new Map();
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
      existing.latencyWeightedSum +=
        (sample.avgLatencyMs || 0) * Math.max(sample.requestCount || 0, 1);
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

  const allAlerts = await readAlerts(5000);
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

  const rules = await readRules();
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

  const instanceSeriesMap = new Map();
  snapshots.forEach((snapshot) => {
    const key = `${snapshot.serverName}::${snapshot.instanceId}`;
    const point = {
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
    const existing = instanceSeriesMap.get(key);
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

  const tenantSeriesMap = new Map();
  snapshots.forEach((snapshot) => {
    (snapshot.tenantSamples || []).forEach((sample) => {
      const identity = resolveTenantIdentity(sample);
      if (tenantId && identity.tenantId !== tenantId) return;
      const key = identity.key;
      const point = {
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
    .sort(
      (a, b) =>
        b.points.reduce((sum, p) => sum + p.requestCount, 0) -
        a.points.reduce((sum, p) => sum + p.requestCount, 0)
    );

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
};

const eventsHandler = async (req, res) => {
  if (!requireAuth(req, res)) return;

  const page = toPage(req.query.page);
  const limit = toLimit(req.query.limit, 25, 200);
  const minutes = Math.min(Math.max(toNumber(req.query.minutes, 60), 5), 24 * 60);
  const severity = str(req.query.severity).trim();
  const status = str(req.query.status).trim();
  const tenantId = str(req.query.tenantId).trim();
  const serverName = str(req.query.serverName).trim();
  const instanceId = str(req.query.instanceId).trim();
  const sinceTs = Date.now() - minutes * 60_000;

  const all = await readAlerts(5000);
  const filtered = all
    .filter((event) => {
      const ts = new Date(event.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < sinceTs) return false;
      if (severity && event.severity !== severity) return false;
      if (status && event.status !== status) return false;
      if (tenantId && event.tenantId !== tenantId) return false;
      if (serverName && event.serverName !== serverName) return false;
      if (instanceId && event.instanceId !== instanceId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = filtered.length;
  const start = (page - 1) * limit;
  const events = filtered.slice(start, start + limit);
  res.status(200).json({ page, limit, total, events });
};

const rulesListHandler = async (req, res) => {
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    const rules = await readRules();
    rules.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    res.status(200).json({ rules: rules.map(serializeRule) });
    return;
  }

  if (req.method === 'POST') {
    const payload = normalizeRulePayload(req.body || {});
    const created = await createRule(payload);
    res.status(201).json({ rule: serializeRule(created) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
};

const ruleByIdHandler = async (req, res) => {
  if (!requireAuth(req, res)) return;

  const id = str(req.params?.id).trim();
  if (!id) {
    res.status(400).json({ error: 'Rule id is required' });
    return;
  }

  const rules = await readRules();
  const existing = rules.find((rule) => rule.id === id);
  if (!existing) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  if (req.method === 'PUT') {
    const payload = normalizeRulePayload(req.body || {});
    const updated = await updateRule(id, payload);
    if (!updated) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(200).json({ rule: serializeRule(updated) });
    return;
  }

  if (req.method === 'DELETE') {
    const deleted = await deleteRule(id);
    if (!deleted) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  res.status(405).end();
};

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'idp-monitoring-service',
    version: pkg.version,
    now: new Date().toISOString(),
  });
});

app.post('/ingest', (req, res, next) => {
  void ingestHandler(req, res).catch(next);
});

app.post('/api/admin/monitoring/ingest', (req, res, next) => {
  void ingestHandler(req, res).catch(next);
});

app.get('/api/admin/monitoring/summary', (req, res, next) => {
  void summaryHandler(req, res).catch(next);
});

app.get('/api/admin/monitoring/events', (req, res, next) => {
  void eventsHandler(req, res).catch(next);
});

app.get('/api/admin/monitoring/rules', (req, res, next) => {
  void rulesListHandler(req, res).catch(next);
});

app.post('/api/admin/monitoring/rules', (req, res, next) => {
  void rulesListHandler(req, res).catch(next);
});

app.put('/api/admin/monitoring/rules/:id', (req, res, next) => {
  void ruleByIdHandler(req, res).catch(next);
});

app.delete('/api/admin/monitoring/rules/:id', (req, res, next) => {
  void ruleByIdHandler(req, res).catch(next);
});

app.use((err, _req, res, _next) => {
  console.error('[monitoring] unhandled error:', err instanceof Error ? err.message : String(err));
  if (res.headersSent) return;
  const statusCode =
    Number(err?.statusCode || err?.status || 500) >= 400 &&
    Number(err?.statusCode || err?.status || 500) < 600
      ? Number(err?.statusCode || err?.status || 500)
      : 500;
  const message = statusCode >= 500 ? 'Internal Server Error' : String(err?.message || 'Request failed');
  res.status(statusCode).json({ error: message });
});

const host = (process.env.MONITORING_HOST || '0.0.0.0').trim();
const port = parseIntBounded(process.env.MONITORING_PORT, 3011, 1, 65535);
const { server, protocol } = createIngressServer();

server.listen(port, host, () => {
  console.log(
    `[monitoring] listening on ${protocol}://${host}:${port} (version: ${pkg.version})`
  );
});
