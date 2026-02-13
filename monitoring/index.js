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
  meta: (instanceKey) => `monitoring:instance:${instanceKey}:meta`,
  heartbeat: (instanceKey) => `monitoring:instance:${instanceKey}:heartbeat`,
  snapshots: (instanceKey) => `monitoring:snapshots:${instanceKey}`,
  alerts: 'monitoring:alerts',
};

const DEFAULT_SNAPSHOT_RETENTION = 21600;
const DEFAULT_ALERT_RETENTION = 5000;
const DEFAULT_INSTANCE_TTL_SEC = 30;
const DEFAULT_TLS_REQUIRED = true;

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

app.use((err, _req, res, _next) => {
  console.error('[monitoring] unhandled error:', err instanceof Error ? err.message : String(err));
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal Server Error' });
});

const host = (process.env.MONITORING_HOST || '0.0.0.0').trim();
const port = parseIntBounded(process.env.MONITORING_PORT, 3011, 1, 65535);
const { server, protocol } = createIngressServer();

server.listen(port, host, () => {
  console.log(
    `[monitoring] listening on ${protocol}://${host}:${port} (version: ${pkg.version})`
  );
});
