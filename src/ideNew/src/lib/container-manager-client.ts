import * as http from 'node:http';
import * as https from 'node:https';

const resolveContainerManagerUrl = () =>
  String(process.env.AGENT_CONTAINER_MANAGER_URL || '')
    .trim()
    .replace(/\/+$/, '');

const resolveContainerManagerToken = () =>
  String(process.env.AGENT_CONTAINER_MANAGER_TOKEN || '').trim();

const isTruthy = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveContainerManagerInsecureTls = () =>
  isTruthy(String(process.env.AGENT_CONTAINER_MANAGER_INSECURE_TLS || ''));

type NodeClientInit = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  insecureTls?: boolean;
};

const requestWithNodeClient = async (urlString: string, init: NodeClientInit) =>
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

export const hasContainerManager = () => Boolean(resolveContainerManagerUrl());

type CallContainerManagerInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  withAuth?: boolean;
};

export const callContainerManager = async <T = any>(
  pathName: string,
  init?: CallContainerManagerInit
): Promise<T> => {
  const base = resolveContainerManagerUrl();
  if (!base) {
    throw new Error('AGENT_CONTAINER_MANAGER_URL is not configured');
  }

  const withAuth = init?.withAuth !== false;
  const token = resolveContainerManagerToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init?.headers || {}),
  };
  if (withAuth && token) {
    headers.authorization = `Bearer ${token}`;
  }

  const pathWithSlash = pathName.startsWith('/') ? pathName : `/${pathName}`;
  const url = `${base}${pathWithSlash}`;

  let statusCode = 0;
  let text = '';
  try {
    const result = await requestWithNodeClient(url, {
      method: String(init?.method || 'GET').toUpperCase(),
      headers,
      body: init?.body,
      insecureTls: resolveContainerManagerInsecureTls(),
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

type ContainerManagerVersion = {
  ok?: boolean;
  service?: string;
  version?: string;
  startedAt?: string;
  now?: string;
};

export const getContainerManagerVersion = async (): Promise<ContainerManagerVersion> =>
  callContainerManager<ContainerManagerVersion>('/api/version', {
    method: 'GET',
    withAuth: false,
  });
