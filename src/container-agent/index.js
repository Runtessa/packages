const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const Docker = require('dockerode');
const selfsigned = require('selfsigned');
const pkg = require('./package.json');

const app = express();
app.use(
  express.json({
    limit:
      process.env.CONTAINER_MANAGER_PAYLOAD_LIMIT ||
      process.env.CONTAINER_AGENT_PAYLOAD_LIMIT ||
      '1mb',
  })
);

const DEFAULT_TLS_REQUIRED = true;
const DEFAULT_HEALTH_PORT = 4040;
const DEFAULT_CODEX_PORT_START = 4600;
const DEFAULT_CODEX_PORT_END = 4899;
const DEFAULT_MONITORING_PORT = 3011;
const MANAGER_LABEL = 'container-manager';
const LEGACY_MANAGER_LABEL = 'container-agent';
const MANAGED_LABEL_VALUES = [MANAGER_LABEL, LEGACY_MANAGER_LABEL];

const pickEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== 'string') continue;
    if (!value.trim()) continue;
    return value.trim();
  }
  return '';
};

const asBool = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseIntBounded = (value, fallback, min, max) => {
  if (typeof value === 'string' && !value.trim()) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
};

const parseCsvList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const resolvePathSafe = (value) =>
  path.isAbsolute(value) ? value : path.resolve(__dirname, value);

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const sanitizeSegment = (value, max = 48) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, max);

const hashText = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const resolveToken = () => pickEnv('CONTAINER_MANAGER_TOKEN', 'CONTAINER_AGENT_TOKEN');

const timingSafeEqual = (left, right) => {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const extractBearer = (header) => {
  if (!header || typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const requireAuth = (req, res, next) => {
  const token = resolveToken();
  if (!token) {
    res.status(503).json({ error: 'CONTAINER_MANAGER_TOKEN is required' });
    return;
  }
  const provided = extractBearer(req.headers.authorization);
  if (!provided || !timingSafeEqual(provided, token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

const resolveTlsPath = (filePath) =>
  path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, filePath);

const readTlsFile = (filePath, label) => {
  const resolved = resolveTlsPath(filePath);
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    throw new Error(`Failed to read ${label} at ${resolved}: ${error.message}`);
  }
};

const ensureSelfSignedCerts = (keyPath, certPath) => {
  const resolvedKeyPath = resolveTlsPath(keyPath);
  const resolvedCertPath = resolveTlsPath(certPath);
  if (fs.existsSync(resolvedKeyPath) && fs.existsSync(resolvedCertPath)) return;

  ensureDir(path.dirname(resolvedKeyPath));
  ensureDir(path.dirname(resolvedCertPath));

  const attrs = [
    {
      name: 'commonName',
      value: pickEnv('CONTAINER_MANAGER_TLS_CN', 'CONTAINER_AGENT_TLS_CN') || 'localhost',
    },
  ];
  const cert = selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    days: parseIntBounded(
      pickEnv('CONTAINER_MANAGER_TLS_SELF_SIGNED_DAYS', 'CONTAINER_AGENT_TLS_SELF_SIGNED_DAYS'),
      825,
      1,
      3650
    ),
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  fs.writeFileSync(resolvedKeyPath, cert.private, { mode: 0o600 });
  fs.writeFileSync(resolvedCertPath, cert.cert, { mode: 0o644 });
  console.log(`[container-manager] generated self-signed cert at ${resolvedCertPath}`);
};

const createServer = () => {
  const tlsRequired = asBool(
    pickEnv('CONTAINER_MANAGER_TLS_REQUIRED', 'CONTAINER_AGENT_TLS_REQUIRED'),
    DEFAULT_TLS_REQUIRED
  );
  const tlsEnabled = asBool(
    pickEnv('CONTAINER_MANAGER_TLS_ENABLED', 'CONTAINER_AGENT_TLS_ENABLED'),
    true
  );
  const autoSelfSigned = asBool(
    pickEnv('CONTAINER_MANAGER_TLS_AUTO_SELF_SIGNED', 'CONTAINER_AGENT_TLS_AUTO_SELF_SIGNED'),
    true
  );
  const keyPath =
    pickEnv('CONTAINER_MANAGER_TLS_KEY_PATH', 'CONTAINER_AGENT_TLS_KEY_PATH') ||
    './certs/server.key';
  const certPath =
    pickEnv('CONTAINER_MANAGER_TLS_CERT_PATH', 'CONTAINER_AGENT_TLS_CERT_PATH') ||
    './certs/server.crt';
  const caPath = pickEnv('CONTAINER_MANAGER_TLS_CA_PATH', 'CONTAINER_AGENT_TLS_CA_PATH');
  const mtlsEnabled = asBool(
    pickEnv('CONTAINER_MANAGER_TLS_MUTUAL', 'CONTAINER_AGENT_TLS_MUTUAL'),
    false
  );

  if (!tlsEnabled) {
    if (tlsRequired) {
      throw new Error('TLS is required but CONTAINER_MANAGER_TLS_ENABLED=false');
    }
    return { server: http.createServer(app), protocol: 'http' };
  }

  if (autoSelfSigned) {
    ensureSelfSignedCerts(keyPath, certPath);
  } else if (!fs.existsSync(resolveTlsPath(keyPath)) || !fs.existsSync(resolveTlsPath(certPath))) {
    throw new Error(
      'TLS key/cert missing. Set CONTAINER_MANAGER_TLS_KEY_PATH and CONTAINER_MANAGER_TLS_CERT_PATH or enable CONTAINER_MANAGER_TLS_AUTO_SELF_SIGNED'
    );
  }

  const options = {
    key: readTlsFile(keyPath, 'TLS key'),
    cert: readTlsFile(certPath, 'TLS cert'),
    requestCert: mtlsEnabled,
    rejectUnauthorized: mtlsEnabled,
  };
  if (caPath) {
    options.ca = readTlsFile(caPath, 'TLS CA cert');
  }
  return { server: https.createServer(options, app), protocol: 'https' };
};

const docker = new Docker({
  socketPath: pickEnv('CONTAINER_MANAGER_SOCKET', 'CONTAINER_AGENT_SOCKET') || '/var/run/docker.sock',
});

const resolveEngineLabel = () => {
  const raw = String(
    pickEnv('CONTAINER_MANAGER_ENGINE_LABEL', 'CONTAINER_AGENT_ENGINE_LABEL') || 'docker'
  )
    .trim()
    .toLowerCase();
  return raw === 'podman' ? 'podman' : 'docker';
};

const resolveManagedSecurityOpts = () => {
  const explicit = parseCsvList(
    pickEnv('CONTAINER_MANAGER_SECURITY_OPTS', 'CONTAINER_AGENT_SECURITY_OPTS')
  );
  if (explicit.length > 0) return explicit;
  if (resolveEngineLabel() === 'podman') return ['label=disable'];
  return [];
};

const codeGatewayImage = () =>
  String(
    pickEnv('CONTAINER_MANAGER_CODEX_IMAGE', 'CONTAINER_AGENT_CODEX_IMAGE') ||
      'idp/codex-gateway:latest'
  ).trim();

const monitoringImage = () =>
  String(
    pickEnv('CONTAINER_MANAGER_MONITORING_IMAGE', 'CONTAINER_AGENT_MONITORING_IMAGE') ||
      'idp-monitoring:latest'
  ).trim();

const codexPrefix = () =>
  sanitizeSegment(
    pickEnv('CONTAINER_MANAGER_CODEX_CONTAINER_PREFIX', 'CONTAINER_AGENT_CODEX_CONTAINER_PREFIX') ||
      'idp-codex-gw',
    40
  ) || 'idp-codex-gw';

const monitoringContainerName = () =>
  sanitizeSegment(
    pickEnv(
      'CONTAINER_MANAGER_MONITORING_CONTAINER_NAME',
      'CONTAINER_AGENT_MONITORING_CONTAINER_NAME'
    ) || 'idp-monitoring',
    64
  ) || 'idp-monitoring';

const managerWorkspaceMountPath = () =>
  String(
    pickEnv(
      'CONTAINER_MANAGER_WORKSPACE_MOUNT_PATH',
      'CONTAINER_AGENT_WORKSPACE_MOUNT_PATH'
    ) || '/srv/idp'
  ).trim();

const codexWorkspaceRoot = () =>
  String(
    pickEnv('CONTAINER_MANAGER_CODEX_WORKSPACE_ROOT', 'CONTAINER_AGENT_CODEX_WORKSPACE_ROOT') ||
      managerWorkspaceMountPath()
  ).trim();

const codexDataVolumePrefix = () =>
  sanitizeSegment(
    pickEnv(
      'CONTAINER_MANAGER_CODEX_DATA_VOLUME_PREFIX',
      'CONTAINER_AGENT_CODEX_DATA_VOLUME_PREFIX'
    ) || `${codexPrefix()}-data`,
    48
  ) || `${codexPrefix()}-data`;

const codexDataVolumeName = (userKey) => {
  const safeUser = sanitizeSegment(userKey || 'anonymous', 40) || 'anonymous';
  return `${codexDataVolumePrefix()}-${safeUser}`;
};

const monitoringDataVolumeName = () =>
  sanitizeSegment(
    pickEnv(
      'CONTAINER_MANAGER_MONITORING_DATA_VOLUME',
      'CONTAINER_AGENT_MONITORING_DATA_VOLUME'
    ) || 'idp-monitoring-data',
    64
  ) || 'idp-monitoring-data';

const codexGatewayIndexPath = () =>
  String(
    pickEnv(
      'CONTAINER_MANAGER_CODEX_GATEWAY_INDEX_PATH',
      'CONTAINER_AGENT_CODEX_GATEWAY_INDEX_PATH'
    ) || `${codexWorkspaceRoot().replace(/[\\]+/g, '/')}/src/codex-gateway/index.js`
  ).trim();

const codexGatewayIndexHostPath = () =>
  String(
    pickEnv(
      'CONTAINER_MANAGER_CODEX_GATEWAY_INDEX_HOST_PATH',
      'CONTAINER_AGENT_CODEX_GATEWAY_INDEX_HOST_PATH'
    )
  ).trim();

const codexPublicHost = () =>
  String(
    pickEnv('CONTAINER_MANAGER_CODEX_PUBLIC_HOST', 'CONTAINER_AGENT_CODEX_PUBLIC_HOST') ||
      '127.0.0.1'
  ).trim() || '127.0.0.1';

const monitoringPublicHost = () =>
  String(
    pickEnv('CONTAINER_MANAGER_MONITORING_PUBLIC_HOST', 'CONTAINER_AGENT_MONITORING_PUBLIC_HOST') ||
      codexPublicHost()
  ).trim() ||
  codexPublicHost();

const getCodexPortRange = () => {
  const start = parseIntBounded(
    pickEnv('CONTAINER_MANAGER_CODEX_PORT_START', 'CONTAINER_AGENT_CODEX_PORT_START'),
    DEFAULT_CODEX_PORT_START,
    1024,
    65530
  );
  const end = parseIntBounded(
    pickEnv('CONTAINER_MANAGER_CODEX_PORT_END', 'CONTAINER_AGENT_CODEX_PORT_END'),
    DEFAULT_CODEX_PORT_END,
    start + 1,
    65535
  );
  return { start, end };
};

const chooseCodexPort = (userKey, preferredPort) => {
  const preferred = Number(preferredPort);
  if (Number.isFinite(preferred) && preferred > 0 && preferred < 65536) {
    return Math.floor(preferred);
  }
  const { start, end } = getCodexPortRange();
  const span = end - start + 1;
  return start + (hashText(userKey) % span);
};

const codexContainerName = (userKey, userName) => {
  const key = sanitizeSegment(userKey, 24) || 'anonymous';
  const name = sanitizeSegment(String(userName || '').toLowerCase(), 32);
  return name ? `${codexPrefix()}-${name}-${key}` : `${codexPrefix()}-${key}`;
};

const userKeyFromInput = (value) => sanitizeSegment(value || 'anonymous', 48) || 'anonymous';

const containerFromName = (name) => docker.getContainer(name);

const inspectContainer = async (name) => {
  try {
    return await containerFromName(name).inspect();
  } catch (error) {
    if (error?.statusCode === 404) return null;
    throw error;
  }
};

let cachedSelfMounts = null;
let cachedSelfMountsAt = 0;
const SELF_MOUNT_CACHE_MS = 10_000;

const normalizeContainerPath = (value) => {
  const normalized = path.posix.normalize(`/${String(value || '').replace(/[\\]+/g, '/')}`);
  return normalized.replace(/\/+$/, '') || '/';
};

const resolveSelfContainerId = () => {
  const explicit = pickEnv(
    'CONTAINER_MANAGER_CONTAINER_ID',
    'CONTAINER_AGENT_CONTAINER_ID',
    'HOSTNAME'
  );
  if (explicit) return String(explicit).trim();
  try {
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
    const match = cgroup.match(/([0-9a-f]{12,64})(?:\.scope)?$/im);
    return match ? String(match[1]).trim() : '';
  } catch {
    return '';
  }
};

const getSelfMounts = async () => {
  const now = Date.now();
  if (cachedSelfMounts && now - cachedSelfMountsAt < SELF_MOUNT_CACHE_MS) {
    return cachedSelfMounts;
  }
  const containerId = resolveSelfContainerId();
  if (!containerId) {
    cachedSelfMounts = [];
    cachedSelfMountsAt = now;
    return cachedSelfMounts;
  }
  try {
    const inspect = await docker.getContainer(containerId).inspect();
    const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
    cachedSelfMounts = mounts
      .filter((mount) => mount?.Source && mount?.Destination)
      .map((mount) => ({
        source: String(mount.Source),
        destination: normalizeContainerPath(mount.Destination),
      }));
    cachedSelfMountsAt = now;
    return cachedSelfMounts;
  } catch {
    cachedSelfMounts = [];
    cachedSelfMountsAt = now;
    return cachedSelfMounts;
  }
};

const mapContainerPathToHostPath = async (containerPath) => {
  const mounts = await getSelfMounts();
  if (!mounts.length) return '';
  const normalizedTarget = normalizeContainerPath(containerPath);
  let bestMatch = null;
  for (const mount of mounts) {
    if (
      normalizedTarget === mount.destination ||
      normalizedTarget.startsWith(`${mount.destination}/`)
    ) {
      if (!bestMatch || mount.destination.length > bestMatch.destination.length) {
        bestMatch = mount;
      }
    }
  }
  if (!bestMatch) return '';
  const relative = path.posix.relative(bestMatch.destination, normalizedTarget);
  if (!relative || relative === '.') return bestMatch.source;
  return path.join(bestMatch.source, relative);
};

const resolveCodexWorkspaceHostPath = async () => {
  const explicit = pickEnv(
    'CONTAINER_MANAGER_WORKSPACE_HOST_PATH',
    'CONTAINER_AGENT_WORKSPACE_HOST_PATH'
  );
  if (explicit) return explicit;
  const mapped = await mapContainerPathToHostPath(codexWorkspaceRoot());
  if (mapped) return mapped;
  return codexWorkspaceRoot();
};

const resolveCodexGatewayIndexHostPath = async () => {
  const explicitHostPath = codexGatewayIndexHostPath();
  if (explicitHostPath) return explicitHostPath;
  const mapped = await mapContainerPathToHostPath(codexGatewayIndexPath());
  if (mapped) return mapped;
  return codexGatewayIndexPath();
};

const ensureImage = async (image) => {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch (error) {
    if (error?.statusCode !== 404) throw error;
  }

  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      docker.modem.followProgress(stream, (pullErr) => {
        if (pullErr) reject(pullErr);
        else resolve(undefined);
      });
    });
  });
};

const extractMappedPort = (inspect, containerPort) => {
  const key = `${containerPort}/tcp`;
  const mapping = inspect?.NetworkSettings?.Ports?.[key];
  if (!Array.isArray(mapping) || !mapping[0]?.HostPort) return null;
  const port = Number(mapping[0].HostPort);
  if (!Number.isFinite(port)) return null;
  return port;
};

const ensureCodexConfig = async (userKey, userName, preferredPort) => {
  const workspaceRoot = await resolveCodexWorkspaceHostPath();
  const image = codeGatewayImage();
  const port = chooseCodexPort(userKey, preferredPort);
  const name = codexContainerName(userKey, userName);
  const dataVolume = codexDataVolumeName(userKey);
  const binds = [`${workspaceRoot}:/workspace`, `${dataVolume}:/data`];
  const gatewayIndexInsideManager = codexGatewayIndexPath();
  if (gatewayIndexInsideManager && fs.existsSync(gatewayIndexInsideManager)) {
    const gatewayIndexHostPath = await resolveCodexGatewayIndexHostPath();
    if (gatewayIndexHostPath) {
      binds.push(`${gatewayIndexHostPath}:/app/index.js:ro`);
    }
  } else {
    const explicitGatewayIndexHostPath = codexGatewayIndexHostPath();
    if (explicitGatewayIndexHostPath) {
      binds.push(`${explicitGatewayIndexHostPath}:/app/index.js:ro`);
    }
  }
  return {
    name,
    image,
    port,
    binds,
    env: [
      'PORT=4040',
      'WORKSPACE_ROOT=/workspace',
      'CODEX_GATEWAY_HISTORY_FILE=/data/history.json',
      'CODEX_GATEWAY_PROFILES_DIR=/data/profiles',
    ],
  };
};

const ensureMonitoringConfig = async () => {
  const image = monitoringImage();
  const name = monitoringContainerName();
  const port = parseIntBounded(
    pickEnv('CONTAINER_MANAGER_MONITORING_PORT', 'CONTAINER_AGENT_MONITORING_PORT'),
    DEFAULT_MONITORING_PORT,
    1,
    65535
  );
  const dataVolume = monitoringDataVolumeName();
  const env = [
    `MONITORING_PORT=${DEFAULT_MONITORING_PORT}`,
    `REDIS_URL=${String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_REDIS_URL',
        'CONTAINER_AGENT_MONITORING_REDIS_URL',
        'REDIS_URL'
      ) || 'redis://localhost:6379'
    ).trim()}`,
    `MONITORING_INGEST_TOKEN=${String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_INGEST_TOKEN',
        'CONTAINER_AGENT_MONITORING_INGEST_TOKEN',
        'MONITORING_INGEST_TOKEN'
      )
    ).trim()}`,
    `MONITORING_TLS_REQUIRED=${String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_TLS_REQUIRED',
        'CONTAINER_AGENT_MONITORING_TLS_REQUIRED'
      ) || 'true'
    ).trim()}`,
    `MONITORING_TLS_ENABLED=${String(
      pickEnv('CONTAINER_MANAGER_MONITORING_TLS_ENABLED', 'CONTAINER_AGENT_MONITORING_TLS_ENABLED') ||
        'true'
    ).trim()}`,
    `MONITORING_TLS_AUTO_SELF_SIGNED=${String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_TLS_AUTO_SELF_SIGNED',
        'CONTAINER_AGENT_MONITORING_TLS_AUTO_SELF_SIGNED'
      ) || 'true'
    ).trim()}`,
    `MONITORING_TLS_KEY_PATH=${String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_TLS_KEY_PATH',
        'CONTAINER_AGENT_MONITORING_TLS_KEY_PATH'
      ) || '/app/certs/server.key'
    ).trim()}`,
    `MONITORING_TLS_CERT_PATH=${String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_TLS_CERT_PATH',
        'CONTAINER_AGENT_MONITORING_TLS_CERT_PATH'
      ) || '/app/certs/server.crt'
    ).trim()}`,
  ];
  return {
    name,
    image,
    port,
    binds: [`${dataVolume}:/app/certs`],
    env,
  };
};

const createContainerIfMissing = async ({
  name,
  image,
  port,
  binds,
  env,
  labels,
  containerPort,
}) => {
  const existing = await inspectContainer(name);
  if (existing) return existing;

  await ensureImage(image);

  const securityOpts = resolveManagedSecurityOpts();
  const container = await docker.createContainer({
    name,
    Image: image,
    Env: env,
    Labels: labels,
    ExposedPorts: {
      [`${containerPort}/tcp`]: {},
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      PortBindings: {
        [`${containerPort}/tcp`]: [{ HostPort: String(port) }],
      },
      Binds: binds,
      ...(securityOpts.length > 0 ? { SecurityOpt: securityOpts } : {}),
    },
  });
  await container.start();
  return inspectContainer(name);
};

const startContainerIfStopped = async (name, inspect) => {
  if (inspect?.State?.Running) return inspect;
  await containerFromName(name).start();
  return inspectContainer(name);
};

const applyAction = async (name, action) => {
  const inspect = await inspectContainer(name);
  if (!inspect) {
    if (action === 'remove') return;
    throw new Error(`Container ${name} does not exist`);
  }
  const container = containerFromName(name);
  if (action === 'start') {
    if (!inspect.State?.Running) await container.start();
    return;
  }
  if (action === 'stop') {
    if (inspect.State?.Running) await container.stop();
    return;
  }
  if (action === 'restart') {
    await container.restart();
    return;
  }
  if (action === 'remove') {
    await container.remove({ force: true });
    return;
  }
  throw new Error(`Unsupported action: ${action}`);
};

const allowedActions = new Set(['create', 'start', 'stop', 'restart', 'remove']);

const parseEnvList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const parseEnvMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const safeKey = String(key || '').trim();
    if (!safeKey) continue;
    result[safeKey] = String(raw ?? '');
  }
  return result;
};

const parseExtraServices = () => {
  const raw =
    pickEnv('CONTAINER_MANAGER_SERVICES_JSON', 'CONTAINER_AGENT_SERVICES_JSON') || '';
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const result = {};
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const key = sanitizeSegment(entry.key, 64);
      const image = String(entry.image || '').trim();
      const containerName = sanitizeSegment(entry.containerName, 64);
      if (!key || !image || !containerName) continue;
      const containerPort = parseIntBounded(entry.containerPort, 8080, 1, 65535);
      const hostPort = parseIntBounded(entry.hostPort, containerPort, 1, 65535);
      const protocol =
        String(entry.protocol || 'http').trim().toLowerCase() === 'https' ? 'https' : 'http';
      const publicHost = String(entry.publicHost || codexPublicHost()).trim() || codexPublicHost();
      const envMap = parseEnvMap(entry.envMap);
      const env = [
        ...parseEnvList(entry.env),
        ...Object.entries(envMap).map(([k, v]) => `${k}=${v}`),
      ];
      const binds = parseEnvList(entry.binds);
      const labels = parseEnvMap(entry.labels);
      result[key] = {
        key,
        image,
        containerName,
        containerPort,
        hostPort,
        protocol,
        publicHost,
        env,
        binds,
        labels,
      };
    }
    return result;
  } catch {
    return {};
  }
};

const parseQueryBool = (value, fallback) => {
  if (Array.isArray(value)) {
    return parseQueryBool(value[0], fallback);
  }
  if (typeof value !== 'string') return fallback;
  return asBool(value, fallback);
};

const resolveAllowUnmanagedActions = () =>
  asBool(
    pickEnv(
      'CONTAINER_MANAGER_ALLOW_UNMANAGED_ACTIONS',
      'CONTAINER_AGENT_ALLOW_UNMANAGED_ACTIONS'
    ),
    true
  );

const formatContainerSummary = (row) => ({
  id: row.Id,
  names: row.Names,
  image: row.Image,
  imageId: row.ImageID,
  command: row.Command,
  created: row.Created,
  state: row.State,
  status: row.Status,
  labels: row.Labels,
  ports: row.Ports,
});

const readDockerLogBuffer = async (value) => {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (typeof value.on === 'function') {
    const chunks = [];
    await new Promise((resolve, reject) => {
      value.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      value.on('end', resolve);
      value.on('error', reject);
    });
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
};

const demuxDockerLogs = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  let offset = 0;
  const lines = [];
  while (offset + 8 <= buffer.length) {
    const streamType = buffer[offset];
    const chunkLength = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > buffer.length) {
      break;
    }
    const payload = buffer.slice(start, end).toString('utf8');
    if (payload) {
      const prefix = streamType === 2 ? '[stderr] ' : streamType === 1 ? '[stdout] ' : '';
      lines.push(
        payload
          .split('\n')
          .filter((line) => line.length > 0)
          .map((line) => `${prefix}${line}`)
          .join('\n')
      );
    }
    offset = end;
  }
  if (offset === 0) {
    return buffer.toString('utf8');
  }
  return lines.filter(Boolean).join('\n');
};

const resolveManagedServiceDefinition = async (serviceKey, userKey, userName, preferredPort) => {
  if (serviceKey === 'codex-gateway') {
    const config = await ensureCodexConfig(userKey || 'anonymous', userName || '', preferredPort);
    return {
      key: serviceKey,
      containerName: config.name,
      image: config.image,
      containerPort: DEFAULT_HEALTH_PORT,
      hostPort: config.port,
      protocol: 'http',
      publicHost: codexPublicHost(),
      env: config.env,
      binds: config.binds,
      labels: {
        'idp.service': 'codex-gateway',
        ...(userKey ? { 'idp.user': userKey } : {}),
      },
    };
  }
  if (serviceKey === 'monitoring') {
    const config = await ensureMonitoringConfig();
    return {
      key: serviceKey,
      containerName: config.name,
      image: config.image,
      containerPort: DEFAULT_MONITORING_PORT,
      hostPort: config.port,
      protocol: 'https',
      publicHost: monitoringPublicHost(),
      env: config.env,
      binds: config.binds,
      labels: {
        'idp.service': 'monitoring',
      },
    };
  }
  const extras = parseExtraServices();
  const extra = extras[serviceKey];
  if (!extra) return null;
  return {
    key: extra.key,
    containerName: extra.containerName,
    image: extra.image,
    containerPort: extra.containerPort,
    hostPort: extra.hostPort,
    protocol: extra.protocol,
    publicHost: extra.publicHost,
    env: extra.env,
    binds: extra.binds,
    labels: {
      'idp.service': serviceKey,
      ...extra.labels,
    },
  };
};

const isManagedContainer = (inspect) => {
  const label = String(inspect?.Config?.Labels?.['idp.managed.by'] || '').trim();
  return MANAGED_LABEL_VALUES.includes(label);
};

const buildStateForService = async (serviceDefinition, userKey = null) => {
  const inspect = await inspectContainer(serviceDefinition.containerName);
  const running = Boolean(inspect?.State?.Running);
  const port = inspect
    ? extractMappedPort(inspect, serviceDefinition.containerPort) ?? serviceDefinition.hostPort
    : serviceDefinition.hostPort;
  return {
    service: serviceDefinition.key,
    ...(userKey ? { userKey } : {}),
    containerName: serviceDefinition.containerName,
    engine: resolveEngineLabel(),
    image: serviceDefinition.image,
    exists: Boolean(inspect),
    running,
    port,
    host: serviceDefinition.publicHost,
    baseUrl: `${serviceDefinition.protocol}://${serviceDefinition.publicHost}:${port}`,
  };
};

const ensureManagedService = async (serviceDefinition, userKey = null) => {
  const labels = {
    'idp.managed.by': MANAGER_LABEL,
    ...serviceDefinition.labels,
  };
  let inspect = await createContainerIfMissing({
    name: serviceDefinition.containerName,
    image: serviceDefinition.image,
    port: serviceDefinition.hostPort,
    binds: serviceDefinition.binds,
    env: serviceDefinition.env,
    labels,
    containerPort: serviceDefinition.containerPort,
  });
  inspect = await startContainerIfStopped(serviceDefinition.containerName, inspect);
  const port =
    extractMappedPort(inspect, serviceDefinition.containerPort) ?? serviceDefinition.hostPort;
  return {
    service: serviceDefinition.key,
    ...(userKey ? { userKey } : {}),
    containerName: serviceDefinition.containerName,
    engine: resolveEngineLabel(),
    image: serviceDefinition.image,
    exists: true,
    running: Boolean(inspect?.State?.Running),
    port,
    host: serviceDefinition.publicHost,
    baseUrl: `${serviceDefinition.protocol}://${serviceDefinition.publicHost}:${port}`,
  };
};

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'idp-container-manager',
    version: pkg.version,
    engine: resolveEngineLabel(),
    now: new Date().toISOString(),
  });
});

app.get('/api/version', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'idp-container-manager',
    version: pkg.version,
    startedAt: STARTED_AT,
    now: new Date().toISOString(),
  });
});

app.use('/v1', requireAuth);

app.get('/v1/services', async (_req, res) => {
  const extras = parseExtraServices();
  const services = [
    { key: 'codex-gateway', userScoped: true, managed: true },
    { key: 'monitoring', userScoped: false, managed: true },
    ...Object.keys(extras).map((key) => ({ key, userScoped: false, managed: true })),
  ];
  res.status(200).json({ ok: true, services });
});

app.get('/v1/services/:service/state', async (req, res, next) => {
  try {
    const serviceKey = sanitizeSegment(req.params.service, 64);
    const userKey = userKeyFromInput(req.query.userId || 'anonymous');
    const userName = String(req.query.userName || '').trim();
    const service = await resolveManagedServiceDefinition(serviceKey, userKey, userName, null);
    if (!service) {
      res.status(404).json({ error: `Unknown service: ${serviceKey}` });
      return;
    }
    const state = await buildStateForService(
      service,
      serviceKey === 'codex-gateway' ? userKey : null
    );
    res.status(200).json({ ok: true, state });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/services/:service/ensure', async (req, res, next) => {
  try {
    const serviceKey = sanitizeSegment(req.params.service, 64);
    const userKey = userKeyFromInput(req.body?.userId || 'anonymous');
    const userName = String(req.body?.userName || '').trim();
    const preferredPort = req.body?.preferredPort;
    const service = await resolveManagedServiceDefinition(
      serviceKey,
      userKey,
      userName,
      preferredPort
    );
    if (!service) {
      res.status(404).json({ error: `Unknown service: ${serviceKey}` });
      return;
    }
    const state = await ensureManagedService(
      service,
      serviceKey === 'codex-gateway' ? userKey : null
    );
    res.status(200).json({ ok: true, state });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/services/:service/action', async (req, res, next) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!allowedActions.has(action)) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }
    const serviceKey = sanitizeSegment(req.params.service, 64);
    const userKey = userKeyFromInput(req.body?.userId || 'anonymous');
    const userName = String(req.body?.userName || '').trim();
    const preferredPort = req.body?.preferredPort;
    const service = await resolveManagedServiceDefinition(
      serviceKey,
      userKey,
      userName,
      preferredPort
    );
    if (!service) {
      res.status(404).json({ error: `Unknown service: ${serviceKey}` });
      return;
    }

    if (action === 'create') {
      const state = await ensureManagedService(
        service,
        serviceKey === 'codex-gateway' ? userKey : null
      );
      res.status(200).json({ ok: true, state });
      return;
    }

    await applyAction(service.containerName, action);
    const state = await buildStateForService(
      service,
      serviceKey === 'codex-gateway' ? userKey : null
    );
    res.status(200).json({ ok: true, state });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/containers/list', async (req, res, next) => {
  try {
    const managedOnly = parseQueryBool(req.query.managedOnly, true);
    const query = {
      all: true,
      ...(managedOnly
        ? {
            filters: {
              label: MANAGED_LABEL_VALUES.map((value) => `idp.managed.by=${value}`),
            },
          }
        : {}),
    };
    const list = await docker.listContainers(query);
    const serviceFilter = String(req.query.service || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();
    const filtered = list.filter((row) => {
      if (serviceFilter) {
        const service = String(row.Labels?.['idp.service'] || '').trim();
        if (service !== serviceFilter) return false;
      }
      if (!search) return true;
      const haystack = [
        row.Id,
        ...(Array.isArray(row.Names) ? row.Names : []),
        row.Image,
        row.Command,
        row.Status,
        row.Labels?.['idp.service'] || '',
      ]
        .map((entry) => String(entry || '').toLowerCase())
        .join(' ');
      return haystack.includes(search);
    });

    res.status(200).json({
      ok: true,
      managedOnly,
      total: filtered.length,
      containers: filtered.map(formatContainerSummary),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/containers/:containerName/inspect', async (req, res, next) => {
  try {
    const containerName = sanitizeSegment(req.params.containerName || '', 128);
    if (!containerName) {
      res.status(400).json({ error: 'containerName is required' });
      return;
    }
    const inspect = await inspectContainer(containerName);
    if (!inspect) {
      res.status(404).json({ error: `Container ${containerName} not found` });
      return;
    }
    const state = {
      id: inspect.Id,
      name: String(inspect.Name || '').replace(/^\/+/, ''),
      image: inspect.Config?.Image || '',
      created: inspect.Created,
      platform: inspect.Platform || '',
      state: inspect.State || {},
      config: {
        env: inspect.Config?.Env || [],
        cmd: inspect.Config?.Cmd || [],
        entrypoint: inspect.Config?.Entrypoint || [],
        workingDir: inspect.Config?.WorkingDir || '',
        labels: inspect.Config?.Labels || {},
      },
      hostConfig: {
        restartPolicy: inspect.HostConfig?.RestartPolicy || {},
        networkMode: inspect.HostConfig?.NetworkMode || '',
        binds: inspect.HostConfig?.Binds || [],
        portBindings: inspect.HostConfig?.PortBindings || {},
      },
      mounts: inspect.Mounts || [],
      networkSettings: inspect.NetworkSettings || {},
      isManaged: isManagedContainer(inspect),
    };
    res.status(200).json({
      ok: true,
      containerName,
      inspect: state,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/v1/containers/:containerName/logs', async (req, res, next) => {
  try {
    const containerName = sanitizeSegment(req.params.containerName || '', 128);
    if (!containerName) {
      res.status(400).json({ error: 'containerName is required' });
      return;
    }
    const inspect = await inspectContainer(containerName);
    if (!inspect) {
      res.status(404).json({ error: `Container ${containerName} not found` });
      return;
    }
    const tail = parseIntBounded(req.query.tail, 200, 1, 5000);
    const since = parseIntBounded(req.query.since, 0, 0, 4_000_000_000);
    const rawLogs = await containerFromName(containerName).logs({
      stdout: true,
      stderr: true,
      timestamps: true,
      tail,
      ...(since > 0 ? { since } : {}),
    });
    const logBuffer = await readDockerLogBuffer(rawLogs);
    const logs = demuxDockerLogs(logBuffer);
    res.status(200).json({
      ok: true,
      containerName,
      tail,
      logs,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/containers/create', async (req, res, next) => {
  try {
    const image = String(req.body?.image || '').trim();
    if (!image) {
      res.status(400).json({ error: 'image is required' });
      return;
    }

    const requestedName = sanitizeSegment(req.body?.name || '', 128);
    const containerName =
      requestedName || `idp-${sanitizeSegment(image.replace(/[:/@]+/g, '-'), 40) || 'container'}-${Date.now()}`;
    const existing = await inspectContainer(containerName);
    if (existing) {
      res.status(409).json({ error: `Container ${containerName} already exists` });
      return;
    }

    const envList = parseEnvList(req.body?.env);
    const envMap = parseEnvMap(req.body?.envMap);
    const env = [
      ...envList,
      ...Object.entries(envMap).map(([key, value]) => `${key}=${value}`),
    ];
    const binds = parseEnvList(req.body?.binds);
    const labels = parseEnvMap(req.body?.labels);
    const managed = Boolean(req.body?.managed);
    if (managed) {
      labels['idp.managed.by'] = MANAGER_LABEL;
    }

    const rawPorts = Array.isArray(req.body?.ports) ? req.body.ports : [];
    const ExposedPorts = {};
    const PortBindings = {};
    rawPorts.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const containerPort = parseIntBounded(entry.containerPort, 0, 1, 65535);
      if (!containerPort) return;
      const hostPort = parseIntBounded(entry.hostPort, 0, 0, 65535);
      const protocol =
        String(entry.protocol || 'tcp').trim().toLowerCase() === 'udp' ? 'udp' : 'tcp';
      const portKey = `${containerPort}/${protocol}`;
      ExposedPorts[portKey] = {};
      PortBindings[portKey] = hostPort > 0 ? [{ HostPort: String(hostPort) }] : [{}];
    });

    const restartPolicyName = String(req.body?.restartPolicy || 'unless-stopped')
      .trim()
      .toLowerCase();
    const allowedRestartPolicies = new Set([
      'no',
      'always',
      'unless-stopped',
      'on-failure',
    ]);
    const restartPolicy = allowedRestartPolicies.has(restartPolicyName)
      ? restartPolicyName
      : 'unless-stopped';

    const cmd =
      Array.isArray(req.body?.cmd) && req.body.cmd.length
        ? req.body.cmd.map((item) => String(item))
        : typeof req.body?.cmd === 'string' && req.body.cmd.trim()
        ? req.body.cmd
            .trim()
            .split(' ')
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined;
    const entrypoint =
      Array.isArray(req.body?.entrypoint) && req.body.entrypoint.length
        ? req.body.entrypoint.map((item) => String(item))
        : typeof req.body?.entrypoint === 'string' && req.body.entrypoint.trim()
        ? req.body.entrypoint
            .trim()
            .split(' ')
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined;

    await ensureImage(image);
    const securityOpts = resolveManagedSecurityOpts();
    const container = await docker.createContainer({
      name: containerName,
      Image: image,
      ...(env.length ? { Env: env } : {}),
      ...(Object.keys(labels).length ? { Labels: labels } : {}),
      ...(cmd && cmd.length ? { Cmd: cmd } : {}),
      ...(entrypoint && entrypoint.length ? { Entrypoint: entrypoint } : {}),
      ...(Object.keys(ExposedPorts).length ? { ExposedPorts } : {}),
      HostConfig: {
        RestartPolicy: { Name: restartPolicy },
        ...(Object.keys(PortBindings).length ? { PortBindings } : {}),
        ...(binds.length ? { Binds: binds } : {}),
        ...(securityOpts.length > 0 ? { SecurityOpt: securityOpts } : {}),
      },
    });

    const autoStart =
      req.body?.autoStart === undefined ? true : Boolean(req.body?.autoStart);
    if (autoStart) {
      await container.start();
    }

    const created = await inspectContainer(containerName);
    res.status(201).json({
      ok: true,
      containerName,
      created: true,
      running: Boolean(created?.State?.Running),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/v1/containers/action', async (req, res, next) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const containerName = sanitizeSegment(req.body?.containerName || '', 128);
    if (!allowedActions.has(action)) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }
    if (!containerName) {
      res.status(400).json({ error: 'containerName is required' });
      return;
    }
    const inspect = await inspectContainer(containerName);
    if (!inspect) {
      if (action === 'remove') {
        res.status(200).json({ ok: true, removed: true, containerName, existed: false });
        return;
      }
      res.status(404).json({ error: `Container ${containerName} not found` });
      return;
    }

    const allowUnmanaged = resolveAllowUnmanagedActions();
    if (!allowUnmanaged && !isManagedContainer(inspect)) {
      res.status(403).json({
        error:
          'Action denied for unmanaged container. Set CONTAINER_MANAGER_ALLOW_UNMANAGED_ACTIONS=true to override.',
      });
      return;
    }

    await applyAction(containerName, action);
    const nextState = await inspectContainer(containerName);
    res.status(200).json({
      ok: true,
      containerName,
      action,
      exists: Boolean(nextState),
      running: Boolean(nextState?.State?.Running),
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const message = String(error?.message || error || 'Internal error');
  console.error(`[container-manager] ${message}`);
  if (res.headersSent) return;
  res.status(500).json({ error: message });
});

const STARTED_AT = new Date().toISOString();
const host = String(pickEnv('CONTAINER_MANAGER_HOST', 'CONTAINER_AGENT_HOST') || '0.0.0.0').trim();
const port = parseIntBounded(
  pickEnv('CONTAINER_MANAGER_PORT', 'CONTAINER_AGENT_PORT'),
  4070,
  1,
  65535
);
const { server, protocol } = createServer();

server.listen(port, host, () => {
  console.log(
    `[container-manager] listening on ${protocol}://${host}:${port} (engine=${resolveEngineLabel()}, version=${pkg.version})`
  );
});
