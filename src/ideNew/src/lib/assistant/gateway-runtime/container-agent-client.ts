import * as http from 'node:http';
import * as https from 'node:https';
import {
  resolveContainerAgentInsecureTls,
  resolveContainerAgentToken,
  resolveContainerAgentUrl,
} from './config';

const requestWithNodeClient = async (
  urlString: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    insecureTls?: boolean;
  },
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
      },
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

export const requestContainerAgent = async <T = any>(
  pathName: string,
  init?: RequestInit,
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
    const detail = causeCode || errorCode || causeMessage || String(error?.message || 'fetch failed');
    throw new Error(`Failed to reach container-manager at ${url}: ${detail}`);
  }

  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (statusCode < 200 || statusCode >= 300) {
    const detail = parsed?.error || parsed?.message || text || `container-manager request failed (${statusCode})`;
    throw new Error(String(detail));
  }
  return (parsed || {}) as T;
};
