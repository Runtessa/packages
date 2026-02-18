const DEFAULT_PORT_START = 4600;
const DEFAULT_PORT_END = 4899;

export const sanitizeUserKey = (value: string | number) =>
  String(value || 'anonymous').replace(/[^a-zA-Z0-9._-]/g, '_');

export const resolveGatewayMode = () =>
  String(process.env.AGENT_CODEX_GATEWAY_MODE || 'local').trim().toLowerCase();

export const resolveGatewayImage = () =>
  String(process.env.AGENT_CODEX_GATEWAY_IMAGE || 'idp/codex-gateway:latest').trim();

export const resolveContainerPrefix = () =>
  String(process.env.AGENT_CODEX_GATEWAY_CONTAINER_PREFIX || 'idp-codex-gw').trim();

export const resolveGatewayHost = () =>
  String(process.env.AGENT_CODEX_GATEWAY_HOST || '127.0.0.1').trim() || '127.0.0.1';

export const resolveContainerAgentUrl = () =>
  String(process.env.AGENT_CONTAINER_MANAGER_URL || '').trim().replace(/\/+$/, '');

export const resolveContainerAgentToken = () =>
  String(process.env.AGENT_CONTAINER_MANAGER_TOKEN || '').trim();

const isTruthy = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const resolveContainerAgentInsecureTls = () =>
  isTruthy(String(process.env.AGENT_CONTAINER_MANAGER_INSECURE_TLS || ''));

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

export const maybeNumber = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
};

export const mapEngine = (value: unknown): 'docker' | 'podman' => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'podman' ? 'podman' : 'docker';
};

export const choosePort = (userKey: string) => {
  const { start, end } = resolvePortRange();
  const span = end - start + 1;
  return start + (hashText(userKey) % span);
};

export const buildContainerName = (userKey: string, userName?: string | null) => {
  const prefix = resolveContainerPrefix();
  const safeName = sanitizeUserKey(String(userName || '').toLowerCase())
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32);
  const safeKey = sanitizeUserKey(userKey).slice(0, 24);
  return safeName ? `${prefix}-${safeName}-${safeKey}` : `${prefix}-${safeKey}`;
};

export const hasRemoteContainerAgent = () => Boolean(resolveContainerAgentUrl());

export const assertRemoteContainerAgentForContainerMode = (mode: string) => {
  if (mode !== 'container') return;
  if (!hasRemoteContainerAgent()) {
    throw new Error(
      'Container mode requires remote container-manager. Set AGENT_CONTAINER_MANAGER_URL and AGENT_CONTAINER_MANAGER_TOKEN. Local Docker/Podman access from IDE is disabled.',
    );
  }
};
