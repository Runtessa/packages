import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';

const normalizeBaseUrl = (raw: unknown, fallback: string) => {
  if (!raw || typeof raw !== 'string') return fallback;
  return raw.replace(/\/$/, '');
};

const isLocalHost = (url: string) =>
  url.startsWith('http://localhost') ||
  url.startsWith('http://127.0.0.1') ||
  url.startsWith('http://[::1]');

const resolveModelsEndpoint = (baseUrl: string) => {
  if (baseUrl.endsWith('/v1')) return `${baseUrl}/models`;
  if (baseUrl.includes('/v1/')) return `${baseUrl}/models`;
  return `${baseUrl}/v1/models`;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireUser(req);
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const allowClientConfig = String(process.env.AI_ALLOW_CLIENT_CONFIG || '').toLowerCase() === 'true';
  const defaultBaseUrl = process.env.AI_BASE_URL || 'https://api.openai.com';
  const baseUrl = normalizeBaseUrl(req.body?.baseUrl, defaultBaseUrl);
  const provider = String(req.body?.provider || '').toLowerCase();
  const apiKey = String(req.body?.apiKey || process.env.AI_API_KEY || '').trim();

  if (!allowClientConfig && baseUrl !== defaultBaseUrl) {
    res.status(400).json({ error: 'Custom baseUrl is not allowed' });
    return;
  }

  if (!apiKey && !isLocalHost(baseUrl)) {
    res.status(400).json({ error: 'API key is required for this provider' });
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const models: string[] = [];
  if (provider === 'ollama') {
    try {
      const tagRes = await fetch(`${baseUrl}/api/tags`, { headers });
      const tagText = await tagRes.text();
      const tagData = tagText ? JSON.parse(tagText) : {};
      const names = Array.isArray(tagData?.models)
        ? tagData.models.map((item: any) => item?.name).filter(Boolean)
        : [];
      if (names.length > 0) {
        res.status(200).json({ models: names });
        return;
      }
    } catch (err) {
      // fall through to try OpenAI-style models
    }
  }

  const endpoint = resolveModelsEndpoint(baseUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, { headers });
  } catch (err: any) {
    res.status(502).json({
      error: 'Failed to reach AI provider',
      detail: err?.cause?.code || err?.message || 'Network error',
      endpoint,
    });
    return;
  }

  const rawText = await response.text().catch(() => '');
  let data: any = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    res.status(response.status).json({
      error: data?.error?.message || rawText || 'Model fetch failed',
      status: response.status,
      statusText: response.statusText,
      endpoint,
    });
    return;
  }

  if (Array.isArray(data?.models)) {
    data.models.forEach((item: any) => {
      if (typeof item === 'string') models.push(item);
      else if (item?.name) models.push(item.name);
    });
  } else if (Array.isArray(data?.data)) {
    data.data.forEach((item: any) => {
      if (item?.id) models.push(item.id);
    });
  }

  res.status(200).json({ models });
});
