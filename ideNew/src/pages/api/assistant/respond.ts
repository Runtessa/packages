import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const normalizeBaseUrl = (raw: unknown, fallback: string) => {
  if (!raw || typeof raw !== 'string') return fallback;
  return raw.replace(/\/$/, '');
};

const isLocalHost = (url: string) =>
  url.startsWith('http://localhost') ||
  url.startsWith('http://127.0.0.1') ||
  url.startsWith('http://[::1]');

const resolveEndpoint = (baseUrl: string) => {
  if (baseUrl.endsWith('/v1')) return `${baseUrl}/chat/completions`;
  if (baseUrl.includes('/v1/')) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireUser(req);
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const messages = (req.body?.messages || []) as ChatMessage[];
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages are required' });
    return;
  }

  const allowClientConfig = String(process.env.AI_ALLOW_CLIENT_CONFIG || '').toLowerCase() === 'true';
  const defaultBaseUrl = process.env.AI_BASE_URL || 'https://api.openai.com';
  const defaultModel = process.env.AI_MODEL || 'gpt-4o-mini';
  const baseUrl = normalizeBaseUrl(req.body?.baseUrl, defaultBaseUrl);
  const model = String(req.body?.model || defaultModel);
  const apiKey = String(req.body?.apiKey || process.env.AI_API_KEY || '').trim();

  if (!allowClientConfig && baseUrl !== defaultBaseUrl) {
    res.status(400).json({ error: 'Custom baseUrl is not allowed' });
    return;
  }

  if (!apiKey && !isLocalHost(baseUrl)) {
    res.status(400).json({ error: 'API key is required for this provider' });
    return;
  }

  const endpoint = resolveEndpoint(baseUrl);

  const payload = {
    model,
    messages,
    temperature: typeof req.body?.temperature === 'number' ? req.body.temperature : 0.2,
    stream: false,
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
    });
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
      error: data?.error?.message || rawText || 'AI request failed',
      status: response.status,
      statusText: response.statusText,
      endpoint,
    });
    return;
  }

  const content =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    data?.output_text ??
    '';

  res.status(200).json({ content, raw: data });
});
