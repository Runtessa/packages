import type { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireUser } from '@/lib/auth';

const normalizeBaseUrl = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/\/+$/, '');
};

const resolveModelsUrl = (baseUrl: string) => {
  const trimmed = normalizeBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
};

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    res.status(405).end();
    return;
  }

  await requireUser(req);

  const allowClientConfig = process.env.AI_ALLOW_CLIENT_CONFIG === 'true';
  const baseUrl = normalizeBaseUrl(
    (allowClientConfig ? (req.query.baseUrl as string | undefined) : undefined) ??
      process.env.AI_BASE_URL ??
      ''
  );
  const apiKey =
    (allowClientConfig ? (req.query.apiKey as string | undefined) : undefined) ??
    process.env.AI_API_KEY ??
    '';

  if (!baseUrl) {
    res.status(200).json({ models: [] });
    return;
  }

  const url = resolveModelsUrl(baseUrl);
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  const models = Array.isArray(data?.data)
    ? data.data.map((model: { id?: string }) => model?.id).filter(Boolean)
    : [];

  res.status(200).json({ models });
});

