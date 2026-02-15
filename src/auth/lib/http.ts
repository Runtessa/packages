import { Request } from 'express';

export const firstHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value[0] || '' : value || '';

export const requestIp = (req: Request): string | null => {
  const forwarded = firstHeader(req.headers['x-forwarded-for']);
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }

  return req.socket.remoteAddress || null;
};

export const requestUserAgent = (req: Request): string | null => {
  const value = firstHeader(req.headers['user-agent']).trim();
  return value || null;
};

export const safeReturnTo = (value: unknown, fallback = '/'): string => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;

  // only allow same-site relative paths
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    return fallback;
  }

  return raw;
};

export const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};
