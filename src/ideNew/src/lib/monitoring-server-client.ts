import * as http from 'node:http';
import * as https from 'node:https';
import type { NextApiRequest, NextApiResponse } from 'next';
import { callContainerManager, hasContainerManager } from '@/lib/container-manager-client';

const isTruthy = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveMonitoringServerToken = () =>
  String(process.env.MONITORING_SERVER_TOKEN || process.env.MONITORING_INGEST_TOKEN || '').trim();

const resolveMonitoringServerInsecureTls = () =>
  isTruthy(
    String(
      process.env.MONITORING_SERVER_INSECURE_TLS || process.env.AGENT_CONTAINER_MANAGER_INSECURE_TLS || ''
    )
  );

const resolveMonitoringEnforceTls = () =>
  String(process.env.MONITORING_ENFORCE_TLS || '').trim()
    ? isTruthy(String(process.env.MONITORING_ENFORCE_TLS || ''))
    : true;

const resolveMonitoringBaseFromEnv = () =>
  String(process.env.MONITORING_SERVER_URL || '')
    .trim()
    .replace(/\/+$/, '');

const requestWithNodeClient = async (
  urlString: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    insecureTls?: boolean;
  }
) =>
  new Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
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
            headers: res.headers,
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

const queryToSearch = (query: NextApiRequest['query']) => {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (typeof entry === 'string') params.append(key, entry);
      });
      return;
    }
    if (typeof value === 'string') params.append(key, value);
  });
  const built = params.toString();
  return built ? `?${built}` : '';
};

const resolveMonitoringBaseUrl = async () => {
  if (hasContainerManager()) {
    const state = await callContainerManager<{
      ok?: boolean;
      state?: { running?: boolean; baseUrl?: string; containerName?: string };
    }>('/v1/services/monitoring/state', { method: 'GET' });
    const base = String(state?.state?.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) {
      throw new Error('container-manager did not return monitoring baseUrl');
    }
    if (!state?.state?.running) {
      throw new Error(
        `monitoring container is not running (${String(state?.state?.containerName || 'unknown')})`
      );
    }
    return base;
  }

  const base = resolveMonitoringBaseFromEnv();
  if (!base) {
    throw new Error(
      'Monitoring server is not configured. Set MONITORING_SERVER_URL or configure AGENT_CONTAINER_MANAGER_URL.'
    );
  }
  return base;
};

type ProxyOptions = {
  requireTls?: boolean;
  allowPassthroughAuth?: boolean;
  path: string;
};

export const proxyMonitoringRequest = async (
  req: NextApiRequest,
  res: NextApiResponse,
  options: ProxyOptions
) => {
  const requireTls = options.requireTls !== false;
  const monitoringBase = await resolveMonitoringBaseUrl();
  if (requireTls && resolveMonitoringEnforceTls() && !/^https:\/\//i.test(monitoringBase)) {
    throw new Error(
      'MONITORING_ENFORCE_TLS is enabled. Monitoring server base URL must be HTTPS.'
    );
  }

  const inboundAuth = String(req.headers.authorization || '').trim();
  const token = resolveMonitoringServerToken();
  const useInbound = options.allowPassthroughAuth && /^Bearer\s+/i.test(inboundAuth);
  const authHeader = useInbound ? inboundAuth : token ? `Bearer ${token}` : '';

  const method = String(req.method || 'GET').toUpperCase();
  const search = queryToSearch(req.query);
  const url = `${monitoringBase}${options.path}${search}`;

  const result = await requestWithNodeClient(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(req.body || {}),
    insecureTls: resolveMonitoringServerInsecureTls(),
  });

  const contentType = String(result.headers['content-type'] || '');
  res.status(result.statusCode);
  if (contentType.includes('application/json')) {
    try {
      res.json(result.body ? JSON.parse(result.body) : {});
      return;
    } catch {
      // fallback to text
    }
  }
  res.send(result.body);
};
