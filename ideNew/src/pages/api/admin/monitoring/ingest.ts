import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';

const asBearer = (header: string | undefined) => {
  if (!header) return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const asBool = (value: string | undefined, fallback = false) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const resolveIngestProxyUrl = () => {
  const explicit = process.env.MONITORING_INGEST_PROXY_URL?.trim();
  if (explicit) return explicit;
  const full = process.env.MONITORING_SERVER_INGEST_URL?.trim();
  if (full) return full;
  const base = process.env.MONITORING_SERVER_URL?.trim();
  if (!base) return '';
  if (
    /\/api\/admin\/monitoring\/ingest\/?$/i.test(base) ||
    /\/ingest\/?$/i.test(base)
  ) {
    return base;
  }
  return `${base.replace(/\/+$/, '')}/api/admin/monitoring/ingest`;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const targetUrl = resolveIngestProxyUrl();
  if (!targetUrl) {
    res.status(503).json({
      error:
        'Monitoring ingest moved to standalone service. Set MONITORING_INGEST_PROXY_URL or MONITORING_SERVER_URL.',
    });
    return;
  }
  const enforceTls = asBool(process.env.MONITORING_ENFORCE_TLS, true);
  if (enforceTls && !/^https:\/\//i.test(targetUrl)) {
    res.status(503).json({
      error:
        'MONITORING_ENFORCE_TLS is enabled. Configure MONITORING_INGEST_PROXY_URL / MONITORING_SERVER_URL with HTTPS.',
    });
    return;
  }

  const passthroughAuth = asBearer(req.headers.authorization as string | undefined);
  const fallbackToken =
    process.env.MONITORING_INGEST_TOKEN?.trim() ||
    process.env.MONITORING_SERVER_TOKEN?.trim() ||
    '';

  const upstream = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(passthroughAuth
        ? { authorization: `Bearer ${passthroughAuth}` }
        : fallbackToken
          ? { authorization: `Bearer ${fallbackToken}` }
          : {}),
    },
    body: JSON.stringify(req.body || {}),
  });

  const contentType = upstream.headers.get('content-type') || '';
  const text = await upstream.text();
  res.status(upstream.status);
  if (contentType.includes('application/json')) {
    try {
      res.json(JSON.parse(text));
      return;
    } catch {
      // fall back to text
    }
  }

  res.send(text);
});
