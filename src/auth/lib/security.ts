import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { config } from './config';
import { isWhitelistedOrigin } from './services/tenant-whitelist';

export const defaultHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: config.isDevelopment ? ["'self'", 'ws:', 'wss:'] : ["'self'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      scriptSrcAttr: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'no-referrer' },
});

const createLimiter = (max: number): RateLimitRequestHandler =>
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please retry later.' },
  });

export const loginLimiter = createLimiter(config.rateLimit.loginMax);
export const registerLimiter = createLimiter(config.rateLimit.registerMax);
export const oauthLimiter = createLimiter(config.rateLimit.oauthMax);

export const parseBearer = (headerValue: unknown): string => {
  if (!headerValue || typeof headerValue !== 'string') return '';
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const normalizeOrigin = (value: string): string => {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
};

const hostHeaderToHostname = (value: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(`http://${raw}`).hostname.toLowerCase();
  } catch {
    if (raw.startsWith('[') && raw.includes(']')) {
      return raw.slice(1, raw.indexOf(']')).toLowerCase();
    }
    return raw.split(':')[0].toLowerCase();
  }
};

const isPrivateOrLoopbackHost = (hostHeader: string): boolean => {
  const hostname = hostHeaderToHostname(hostHeader);
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true;
  return false;
};

const sameLoopbackHost = (left: string, right: string): boolean => {
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
  return loopback.has(left) && loopback.has(right);
};

const isAuthOrigin = (origin: string, req?: Request): boolean => {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  if (normalized === normalizeOrigin(config.baseUrl)) return true;

  if (!req) return false;

  try {
    const parsedOrigin = new URL(normalized);
    const hostHeader = String(req.get('host') || '').trim().toLowerCase();
    if (!hostHeader) return false;

    const forwardedProto = String(req.get('x-forwarded-proto') || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const requestProto = (forwardedProto || req.protocol || 'http').toLowerCase();
    const requestOrigin = new URL(`${requestProto}://${hostHeader}`);

    if (parsedOrigin.protocol === requestOrigin.protocol && parsedOrigin.host === requestOrigin.host) {
      return true;
    }

    if (
      config.isDevelopment &&
      parsedOrigin.protocol === requestOrigin.protocol &&
      parsedOrigin.port === requestOrigin.port &&
      sameLoopbackHost(parsedOrigin.hostname, requestOrigin.hostname)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

const originAllowed = async (origin: string, req?: Request): Promise<boolean> => {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const inAllowedOrigins = config.allowedOrigins.some((entry) => normalizeOrigin(entry) === normalized);
  if (inAllowedOrigins) return true;

  if (isAuthOrigin(normalized, req)) return true;

  if (config.isProduction && !normalized.startsWith('https://')) {
    return false;
  }

  return isWhitelistedOrigin(normalized);
};

export const requireTrustedOrigin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const rawOrigin = req.headers.origin;
  const origin =
    typeof rawOrigin === 'string' && rawOrigin.trim().toLowerCase() !== 'null'
      ? rawOrigin.trim()
      : '';
  const referer = typeof req.headers.referer === 'string' ? req.headers.referer : '';
  const secFetchSite = String(req.headers['sec-fetch-site'] || '')
    .trim()
    .toLowerCase();
  const host = String(req.get('host') || '').trim().toLowerCase();
  const baseHost = (() => {
    try {
      return new URL(config.baseUrl).host.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (origin && (await originAllowed(origin, req))) {
    next();
    return;
  }

  if (!origin && referer) {
    try {
      const parsed = new URL(referer);
      const refererOrigin = `${parsed.protocol}//${parsed.host}`;
      if (await originAllowed(refererOrigin, req)) {
        next();
        return;
      }
    } catch {
      // ignore parse error
    }
  }

  // Some same-origin form posts may omit Origin/Referer; allow only when browser
  // marks request as same-origin/none and host matches this auth service.
  let hostAllowedWithoutOrigin = false;
  if (host) {
    if (baseHost && host === baseHost) {
      hostAllowedWithoutOrigin = true;
    } else {
      const httpHostOrigin = `http://${host}`;
      const httpsHostOrigin = `https://${host}`;
      hostAllowedWithoutOrigin =
        (await originAllowed(httpHostOrigin, req)) || (await originAllowed(httpsHostOrigin, req));
    }

    // Mobile browsers sometimes omit Origin/Referer for same-origin form posts.
    // In development allow private/LAN hosts to avoid blocking local network testing.
    if (!hostAllowedWithoutOrigin && config.isDevelopment && isPrivateOrLoopbackHost(host)) {
      hostAllowedWithoutOrigin = true;
    }
  }

  if (!origin && !referer && hostAllowedWithoutOrigin) {
    if (!secFetchSite || secFetchSite === 'same-origin' || secFetchSite === 'none') {
      next();
      return;
    }
  }

  const debug =
    config.isDevelopment
      ? {
          origin: typeof origin === 'string' ? origin : null,
          referer: referer || null,
          host,
          secFetchSite: secFetchSite || null,
        }
      : undefined;

  res.status(403).json({ error: 'Untrusted origin', ...(debug ? { debug } : {}) });
};

export const applyCorsForApi = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const origin = req.headers.origin;
  if (origin && (await originAllowed(origin, req))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token');
    res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
};
