import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';

const execFileAsync = promisify(execFile);

const DEFAULT_PORT_START = 4600;
const DEFAULT_PORT_END = 4899;
const HEALTH_TIMEOUT_MS = 20_000;

type RuntimeInfo = {
  baseUrl: string;
  engine: 'docker' | 'podman';
  containerName: string;
  image: string;
  port: number;
};

export type CodexGatewayContainerAction =
  | 'create'
  | 'start'
  | 'stop'
  | 'restart'
  | 'remove';

export type CodexGatewayRuntimeState = {
  mode: string;
  userKey: string;
  userName: string;
  containerName: string;
  engine: 'docker' | 'podman' | null;
  image: string;
  host: string;
  port: number | null;
  baseUrl: string;
  exists: boolean;
  running: boolean;
};

type RuntimeProfile = {
  userKey: string;
  userName: string;
  containerName: string;
  port: number;
  host: string;
  engine: 'docker' | 'podman';
  image: string;
  updatedAt: string;
};

type ContainerInspect = {
  Name?: string;
  State?: {
    Running?: boolean;
  };
  Config?: {
    Labels?: Record<string, string>;
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostPort?: string; HostIp?: string }>>;
  };
};

const sanitizeUserKey = (value: string | number) =>
  String(value || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_');

const resolveRepoRoot = () => {
  const cwd = process.cwd().replace(/\\/g, '/');
  if (cwd.endsWith('/src/ideNew')) return cwd.slice(0, -'/src/ideNew'.length);
  if (cwd.endsWith('/ideNew')) return cwd.slice(0, -'/ideNew'.length);
  return cwd;
};

const resolveGatewayMode = () =>
  String(process.env.AGENT_CODEX_GATEWAY_MODE || 'local')
    .trim()
    .toLowerCase();

const resolveGatewayImage = () =>
  String(process.env.AGENT_CODEX_GATEWAY_IMAGE || 'idp/codex-gateway:latest').trim();

const resolveContainerPrefix = () =>
  String(process.env.AGENT_CODEX_GATEWAY_CONTAINER_PREFIX || 'idp-codex-gw').trim();

const resolveGatewayHost = () =>
  String(process.env.AGENT_CODEX_GATEWAY_HOST || '127.0.0.1').trim() || '127.0.0.1';

const resolveContainerAgentUrl = () =>
  String(process.env.AGENT_CONTAINER_MANAGER_URL || '')
    .trim()
    .replace(/\/+$/, '');

const resolveContainerAgentToken = () =>
  String(process.env.AGENT_CONTAINER_MANAGER_TOKEN || '').trim();

const isTruthy = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveContainerAgentInsecureTls = () =>
  isTruthy(String(process.env.AGENT_CONTAINER_MANAGER_INSECURE_TLS || ''));

const requestWithNodeClient = async (
  urlString: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    insecureTls?: boolean;
  }
) =>
  new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const target = new URL(urlString);
    const isHttps = target.protocol === 'https:';
    const client = isHttps ? https : http;
    const req = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port ? Number(target.port) : undefined,
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers: init.headers,
        rejectUnauthorized: isHttps ? !Boolean(init.insecureTls) : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        });
        res.on('end', () => {
          resolve({
            statusCode: Number(res.statusCode || 0),
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.setTimeout(20_000, () => {
      req.destroy(new Error('request timeout'));
    });
    req.on('error', reject);
    if (typeof init.body === 'string' && init.body.length > 0) {
      req.write(init.body);
    }
    req.end();
  });

const hasRemoteContainerAgent = () => Boolean(resolveContainerAgentUrl());

const assertRemoteContainerAgentForContainerMode = (mode: string) => {
  if (mode !== 'container') return;
  if (!hasRemoteContainerAgent()) {
    throw new Error(
      'Container mode requires remote container-manager. Set AGENT_CONTAINER_MANAGER_URL and AGENT_CONTAINER_MANAGER_TOKEN. Local Docker/Podman access from IDE is disabled.'
    );
  }
};

const resolveProfilesFile = () =>
  path.join(resolveRepoRoot(), 'src', 'ideNew', '.codex-gateway', 'runtime-profiles.json');

const resolvePortRange = () => {
  const raw = String(process.env.AGENT_CODEX_GATEWAY_PORT_RANGE || '').trim();
  const match = raw.match(/^(\d{2,5})\s*-\s*(\d{2,5})$/);
  if (!match) return { start: DEFAULT_PORT_START, end: DEFAULT_PORT_END };
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end <= start) {
    return { start: DEFAULT_PORT_START, end: DEFAULT_PORT_END };
  }
  return { start, end };
};

const hashText = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
};

const maybeNumber = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

const mapEngine = (value: unknown): 'docker' | 'podman' => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'podman' ? 'podman' : 'docker';
};

const requestContainerAgent = async <T = any>(
  pathName: string,
  init?: RequestInit
): Promise<T> => {
  const base = resolveContainerAgentUrl();
  if (!base) {
    throw new Error('AGENT_CONTAINER_MANAGER_URL is not configured');
  }
  const token = resolveContainerAgentToken();
  const headers = new Headers(init?.headers || {});
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const url = `${base}${pathName}`;
  let statusCode = 0;
  let text = '';
  try {
    const result = await requestWithNodeClient(url, {
      method: String(init?.method || 'GET').toUpperCase(),
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === 'string' ? init.body : undefined,
      insecureTls: resolveContainerAgentInsecureTls(),
    });
    statusCode = result.statusCode;
    text = result.body;
  } catch (error: any) {
    const causeCode = String(error?.cause?.code || '').trim();
    const causeMessage = String(error?.cause?.message || '').trim();
    const errorCode = String(error?.code || '').trim();
    const detail =
      causeCode || errorCode || causeMessage || String(error?.message || 'fetch failed');
    throw new Error(`Failed to reach container-manager at ${url}: ${detail}`);
  }
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (statusCode < 200 || statusCode >= 300) {
    const detail =
      parsed?.error || parsed?.message || text || `container-manager request failed (${statusCode})`;
    throw new Error(String(detail));
  }
  return (parsed || {}) as T;
};

type RemoteCodexStatePayload = {
  service?: string;
  containerName?: string;
  engine?: string;
  image?: string;
  exists?: boolean;
  running?: boolean;
  port?: number | null;
  host?: string;
  baseUrl?: string;
};

const toRuntimeStateFromRemote = (
  mode: string,
  userKey: string,
  userName: string,
  state: RemoteCodexStatePayload
): CodexGatewayRuntimeState => {
  const host = String(state.host || resolveGatewayHost()).trim() || resolveGatewayHost();
  const port = maybeNumber(state.port) ?? choosePort(userKey);
  const baseUrl = String(state.baseUrl || `http://${host}:${port}`).replace(/\/+$/, '');
  return {
    mode,
    userKey,
    userName,
    containerName: String(state.containerName || buildContainerName(userKey, userName)),
    engine: mapEngine(state.engine),
    image: String(state.image || resolveGatewayImage()),
    host,
    port,
    baseUrl,
    exists: Boolean(state.exists),
    running: Boolean(state.running),
  };
};

const ensureRemoteCodexGatewayForUser = async (
  mode: string,
  userKey: string,
  userName: string
): Promise<CodexGatewayRuntimeState> => {
  const response = await requestContainerAgent<{ ok?: boolean; state?: RemoteCodexStatePayload }>(
    '/v1/services/codex-gateway/ensure',
    {
      method: 'POST',
      body: JSON.stringify({
        userId: userKey,
        userName,
      }),
    }
  );
  return toRuntimeStateFromRemote(mode, userKey, userName, response.state || {});
};

const getRemoteCodexGatewayStateForUser = async (
  mode: string,
  userKey: string,
  userName: string
): Promise<CodexGatewayRuntimeState> => {
  const query = new URLSearchParams({
    userId: userKey,
    userName,
  });
  const response = await requestContainerAgent<{ ok?: boolean; state?: RemoteCodexStatePayload }>(
    `/v1/services/codex-gateway/state?${query.toString()}`,
    { method: 'GET' }
  );
  return toRuntimeStateFromRemote(mode, userKey, userName, response.state || {});
};

const controlRemoteCodexGatewayForUser = async (
  mode: string,
  userKey: string,
  userName: string,
  action: CodexGatewayContainerAction
): Promise<CodexGatewayRuntimeState> => {
  const response = await requestContainerAgent<{ ok?: boolean; state?: RemoteCodexStatePayload }>(
    '/v1/services/codex-gateway/action',
    {
      method: 'POST',
      body: JSON.stringify({
        action,
        userId: userKey,
        userName,
      }),
    }
  );
  return toRuntimeStateFromRemote(mode, userKey, userName, response.state || {});
};

const choosePort = (userKey: string) => {
  const { start, end } = resolvePortRange();
  const span = end - start + 1;
  return start + (hashText(userKey) % span);
};

const buildContainerName = (userKey: string, userName?: string | null) => {
  const prefix = resolveContainerPrefix();
  const safeName = sanitizeUserKey(String(userName || '').toLowerCase())
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32);
  const safeKey = sanitizeUserKey(userKey).slice(0, 24);
  return safeName ? `${prefix}-${safeName}-${safeKey}` : `${prefix}-${safeKey}`;
};

let profileWriteQueue: Promise<void> = Promise.resolve();

const loadProfiles = async (): Promise<Record<string, RuntimeProfile>> => {
  const filePath = resolveProfilesFile();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, RuntimeProfile>;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    return {};
  }
};

const queueSaveProfiles = async (profiles: Record<string, RuntimeProfile>) => {
  const filePath = resolveProfilesFile();
  const payload = JSON.stringify(profiles, null, 2);
  profileWriteQueue = profileWriteQueue
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, payload, 'utf8');
    })
    .catch(() => undefined);
  await profileWriteQueue;
};

const runEngine = async (
  engine: 'docker' | 'podman',
  args: string[],
  options?: { timeoutMs?: number; allowFailure?: boolean },
) => {
  try {
    const result = await execFileAsync(engine, args, {
      timeout: options?.timeoutMs ?? 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      code: 0,
    };
  } catch (error: any) {
    if (options?.allowFailure) {
      return {
        ok: false,
        stdout: String(error?.stdout || ''),
        stderr: String(error?.stderr || error?.message || ''),
        code: maybeNumber(error?.code) ?? 1,
      };
    }
    const message = String(error?.stderr || error?.stdout || error?.message || 'command failed');
    throw new Error(`${engine} ${args.join(' ')} failed: ${message}`);
  }
};

const detectEngine = async (): Promise<'docker' | 'podman'> => {
  const preferred = String(process.env.AGENT_CODEX_GATEWAY_ENGINE || 'auto')
    .trim()
    .toLowerCase();
  const tryEngine = async (engine: 'docker' | 'podman') => {
    const result = await runEngine(engine, ['version'], { allowFailure: true, timeoutMs: 10000 });
    return result.ok;
  };

  if (preferred === 'docker') {
    if (await tryEngine('docker')) return 'docker';
    throw new Error('docker engine is not available');
  }
  if (preferred === 'podman') {
    if (await tryEngine('podman')) return 'podman';
    throw new Error('podman engine is not available');
  }

  if (await tryEngine('docker')) return 'docker';
  if (await tryEngine('podman')) return 'podman';
  throw new Error('neither docker nor podman is available');
};

const ensureGatewayImage = async (engine: 'docker' | 'podman') => {
  const image = resolveGatewayImage();
  const inspect = await runEngine(engine, ['image', 'inspect', image], { allowFailure: true });
  if (inspect.ok) return image;
  if (String(process.env.AGENT_CODEX_GATEWAY_AUTO_BUILD || 'false').trim() === 'false') {
    throw new Error(`gateway image ${image} not found`);
  }
  const repoRoot = resolveRepoRoot();
  const dockerfile = path.join(repoRoot, 'codex-gateway', 'Dockerfile');
  const context = path.join(repoRoot, 'codex-gateway');
  await runEngine(engine, ['build', '-t', image, '-f', dockerfile, context], {
    timeoutMs: 10 * 60 * 1000,
  });
  return image;
};

const inspectContainer = async (
  engine: 'docker' | 'podman',
  containerName: string,
): Promise<ContainerInspect | null> => {
  const result = await runEngine(engine, ['inspect', containerName], { allowFailure: true });
  if (!result.ok) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || !parsed[0] || typeof parsed[0] !== 'object') return null;
    return parsed[0] as ContainerInspect;
  } catch {
    return null;
  }
};

const extractHostBinding = (inspect: ContainerInspect | null) => {
  if (!inspect?.NetworkSettings?.Ports) return null;
  const mapping = inspect.NetworkSettings.Ports['4040/tcp'];
  if (!Array.isArray(mapping) || !mapping[0]?.HostPort) return null;
  const port = Number(mapping[0].HostPort);
  if (!Number.isFinite(port)) return null;
  const rawHost = String(mapping[0].HostIp || '').trim();
  const host =
    rawHost === '0.0.0.0' || rawHost === '::' || !rawHost ? null : rawHost;
  return { port, host };
};

const extractLabelPort = (inspect: ContainerInspect | null) => {
  const raw = inspect?.Config?.Labels?.['idp.codex-gateway.port'];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const ensureContainerStorageWritable = async (
  engine: 'docker' | 'podman',
  containerName: string
) => {
  const probe = await runEngine(
    engine,
    [
      'exec',
      containerName,
      'sh',
      '-lc',
      'mkdir -p /data/profiles/.idp_probe && rm -rf /data/profiles/.idp_probe',
    ],
    { allowFailure: true, timeoutMs: 10000 }
  );
  return probe.ok;
};

const containerHasCaBundle = async (
  engine: 'docker' | 'podman',
  containerName: string
) => {
  const probe = await runEngine(
    engine,
    ['exec', containerName, 'sh', '-lc', 'test -f /etc/ssl/certs/ca-certificates.crt'],
    { allowFailure: true, timeoutMs: 8000 }
  );
  return probe.ok;
};

const ensureContainerCaCertificates = async (
  engine: 'docker' | 'podman',
  containerName: string
) => {
  if (await containerHasCaBundle(engine, containerName)) return;

  const install = await runEngine(
    engine,
    [
      'exec',
      containerName,
      'sh',
      '-lc',
      'apt-get update && apt-get install -y --no-install-recommends ca-certificates && update-ca-certificates',
    ],
    { allowFailure: true, timeoutMs: 120000 }
  );
  if (!install.ok) {
    throw new Error(
      `failed to install CA certificates in ${containerName}: ${String(
        install.stderr || install.stdout || 'unknown error'
      ).trim()}`
    );
  }
};

const removeContainerIfExists = async (
  engine: 'docker' | 'podman',
  containerName: string
) => {
  const rm = await runEngine(engine, ['rm', '-f', containerName], {
    allowFailure: true,
    timeoutMs: 15000,
  });
  return rm.ok;
};

const waitForHealth = async (baseUrl: string) => {
  const started = Date.now();
  while (Date.now() - started < HEALTH_TIMEOUT_MS) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: 'GET' });
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`gateway health check timed out for ${baseUrl}`);
};

const ensureContainerRunning = async (
  engine: 'docker' | 'podman',
  containerName: string,
  userKey: string,
  preferredPort?: number | null,
) => {
  const image = await ensureGatewayImage(engine);
  const inspect = await inspectContainer(engine, containerName);
  if (inspect?.State?.Running) {
    const writable = await ensureContainerStorageWritable(engine, containerName);
    if (!writable) {
      await removeContainerIfExists(engine, containerName);
    } else {
      await ensureContainerCaCertificates(engine, containerName);
      const binding = extractHostBinding(inspect);
      const port =
        binding?.port ??
        extractLabelPort(inspect) ??
        (Number.isFinite(Number(preferredPort)) && Number(preferredPort) > 0
          ? Number(preferredPort)
          : choosePort(userKey));
      const host = binding?.host ?? null;
      return { image, port, host };
    }
  }

  if (inspect && !inspect.State?.Running) {
    await runEngine(engine, ['start', containerName]);
    const started = await inspectContainer(engine, containerName);
    const writable = await ensureContainerStorageWritable(engine, containerName);
    if (!writable) {
      await removeContainerIfExists(engine, containerName);
    } else {
      await ensureContainerCaCertificates(engine, containerName);
      const binding = extractHostBinding(started);
      const port =
        binding?.port ??
        extractLabelPort(started) ??
        (Number.isFinite(Number(preferredPort)) && Number(preferredPort) > 0
          ? Number(preferredPort)
          : choosePort(userKey));
      const host = binding?.host ?? null;
      return { image, port, host };
    }
  }

  const port =
    Number.isFinite(Number(preferredPort)) && Number(preferredPort) > 0
      ? Number(preferredPort)
      : choosePort(userKey);
  const repoRoot = resolveRepoRoot();
  const dataRoot = path.join(repoRoot, 'src', 'ideNew', '.codex-gateway', userKey);
  await fs.mkdir(dataRoot, { recursive: true });
  const volumeSuffix = engine === 'podman' ? ':Z' : '';
  const labels = [
    '--label',
    'idp.codex-gateway=true',
    '--label',
    `idp.codex-gateway.user=${userKey}`,
  ];
  const args = [
    'run',
    '-d',
    '--name',
    containerName,
    '--restart',
    'unless-stopped',
    '-p',
    `${port}:4040`,
    '-e',
    'PORT=4040',
    '-e',
    'WORKSPACE_ROOT=/workspace',
    '-e',
    'CODEX_GATEWAY_HISTORY_FILE=/data/history.json',
    '-e',
    'CODEX_GATEWAY_PROFILES_DIR=/data/profiles',
    '-v',
    `${repoRoot}:/workspace${volumeSuffix}`,
    '-v',
    `${dataRoot}:/data${volumeSuffix}`,
    '-v',
    `${path.join(repoRoot, 'src', 'codex-gateway', 'index.js')}:/app/index.js${volumeSuffix}`,
    ...labels,
    image,
  ];
  await runEngine(engine, args, { timeoutMs: 120000 });
  const started = await inspectContainer(engine, containerName);
  await ensureContainerCaCertificates(engine, containerName);
  const binding = extractHostBinding(started);
  const mappedPort = binding?.port ?? extractLabelPort(started) ?? port;
  const mappedHost = binding?.host ?? null;
  return { image, port: mappedPort, host: mappedHost };
};

export const resolveCodexGatewayBaseForUser = async (
  userId: string | number,
  userName?: string | null,
): Promise<RuntimeInfo> => {
  const mode = resolveGatewayMode();
  if (mode === 'off' || mode === 'none' || mode === 'disabled') {
    throw new Error('codex gateway mode is disabled');
  }
  if (mode !== 'container') {
    const raw = String(
      process.env.AGENT_CODEX_GATEWAY_URL ||
        process.env.CODEX_GATEWAY_URL ||
        'http://127.0.0.1:4040',
    ).trim();
    return {
      baseUrl: raw.replace(/\/+$/, ''),
      engine: 'docker',
      containerName: 'external',
      image: resolveGatewayImage(),
      port: maybeNumber(new URL(raw).port) ?? 4040,
    };
  }

  assertRemoteContainerAgentForContainerMode(mode);
  const userKey = sanitizeUserKey(userId);
  const safeUserName = String(userName || '');
  const state = await ensureRemoteCodexGatewayForUser(mode, userKey, safeUserName);
  if (!state.running) {
    throw new Error(
      `remote container-manager returned non-running state for ${state.containerName}`
    );
  }
  await waitForHealth(state.baseUrl);

  return {
    baseUrl: state.baseUrl,
    engine: state.engine || 'docker',
    containerName: state.containerName,
    image: state.image,
    port: state.port || 4040,
  };
};

export const getCodexGatewayRuntimeStateForUser = async (
  userId: string | number,
  userName?: string | null,
): Promise<CodexGatewayRuntimeState> => {
  const mode = resolveGatewayMode();
  const userKey = sanitizeUserKey(userId);
  const safeUserName = String(userName || '');
  const image = resolveGatewayImage();

  if (mode !== 'container') {
    const raw = String(
      process.env.AGENT_CODEX_GATEWAY_URL ||
        process.env.CODEX_GATEWAY_URL ||
        'http://127.0.0.1:4040',
    ).trim();
    let host = resolveGatewayHost();
    let port = 4040;
    try {
      const parsed = new URL(raw);
      host = parsed.hostname || host;
      port = maybeNumber(parsed.port) ?? port;
    } catch {
      // keep defaults
    }
    return {
      mode,
      userKey,
      userName: safeUserName,
      containerName: 'external',
      engine: null,
      image,
      host,
      port,
      baseUrl: raw.replace(/\/+$/, ''),
      exists: true,
      running: true,
    };
  }

  assertRemoteContainerAgentForContainerMode(mode);
  return getRemoteCodexGatewayStateForUser(mode, userKey, safeUserName);
};

export const controlCodexGatewayContainerForUser = async (
  userId: string | number,
  userName: string | null | undefined,
  action: CodexGatewayContainerAction,
) => {
  const mode = resolveGatewayMode();
  const userKey = sanitizeUserKey(userId);
  const safeUserName = String(userName || '');
  if (mode === 'container') {
    assertRemoteContainerAgentForContainerMode(mode);
    return controlRemoteCodexGatewayForUser(mode, userKey, safeUserName, action);
  }

  const state = await getCodexGatewayRuntimeStateForUser(userId, userName);
  if (state.mode !== 'container' || !state.engine) {
    throw new Error('Container controls are available only in AGENT_CODEX_GATEWAY_MODE=container');
  }

  const containerName = state.containerName;
  const engine = state.engine;
  const profiles = await loadProfiles();

  if (action === 'remove') {
    await removeContainerIfExists(engine, containerName);
    if (profiles[userKey]) {
      delete profiles[userKey];
      await queueSaveProfiles(profiles);
    }
    return getCodexGatewayRuntimeStateForUser(userId, userName);
  }

  if (action === 'create') {
    await resolveCodexGatewayBaseForUser(userId, userName);
    return getCodexGatewayRuntimeStateForUser(userId, userName);
  }

  const inspect = await inspectContainer(engine, containerName);
  if (!inspect) {
    throw new Error(`Container ${containerName} does not exist. Use "create" first.`);
  }

  if (action === 'start') {
    if (!inspect.State?.Running) {
      await runEngine(engine, ['start', containerName], { timeoutMs: 30000 });
    }
    await resolveCodexGatewayBaseForUser(userId, userName);
    return getCodexGatewayRuntimeStateForUser(userId, userName);
  }

  if (action === 'stop') {
    if (inspect.State?.Running) {
      await runEngine(engine, ['stop', containerName], { timeoutMs: 30000 });
    }
    return getCodexGatewayRuntimeStateForUser(userId, userName);
  }

  if (action === 'restart') {
    await runEngine(engine, ['restart', containerName], { timeoutMs: 60000 });
    await resolveCodexGatewayBaseForUser(userId, userName);
    return getCodexGatewayRuntimeStateForUser(userId, userName);
  }

  throw new Error(`Unsupported container action: ${action}`);
};

export const resolveCodexGatewayModeValue = () => resolveGatewayMode();
