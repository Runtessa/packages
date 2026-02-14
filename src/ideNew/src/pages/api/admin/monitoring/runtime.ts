import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import * as http from 'node:http';
import * as https from 'node:https';

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

const callContainerAgent = async <T = any>(path: string, init?: RequestInit): Promise<T> => {
  const base = resolveContainerAgentUrl();
  if (!base) {
    throw new Error('AGENT_CONTAINER_MANAGER_URL is not configured');
  }

  const token = resolveContainerAgentToken();
  const headers = new Headers(init?.headers || {});
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const url = `${base}${path}`;
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

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end();
    return;
  }

  await requireAdmin(req);

  if (req.method === 'GET') {
    const data = await callContainerAgent('/v1/services/monitoring/state', { method: 'GET' });
    res.status(200).json({ ok: true, ...(data as object) });
    return;
  }

  const action = String(req.body?.action || '').trim().toLowerCase();
  const allowed = new Set(['create', 'start', 'stop', 'restart', 'remove']);
  if (!allowed.has(action)) {
    res.status(400).json({
      ok: false,
      error: 'Invalid action. Use create/start/stop/restart/remove.',
    });
    return;
  }

  const data = await callContainerAgent('/v1/services/monitoring/action', {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  res.status(200).json({ ok: true, action, ...(data as object) });
});
