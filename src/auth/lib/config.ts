import path from 'path';

export const asBool = (value: unknown, fallback = false): boolean => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

export const asInt = (
  value: unknown,
  fallback: number,
  min?: number,
  max?: number,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  const withMin = typeof min === 'number' ? Math.max(rounded, min) : rounded;
  return typeof max === 'number' ? Math.min(withMin, max) : withMin;
};

const splitCsv = (raw: unknown): string[] => {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isDevelopment = nodeEnv === 'development';

const baseUrl = (process.env.AUTH_BASE_URL || '').trim() || 'http://localhost:3015';
const port = asInt(process.env.AUTH_PORT, 3015, 1, 65535);
const host = (process.env.AUTH_HOST || '').trim() || '0.0.0.0';

const cookieSecure = asBool(process.env.AUTH_COOKIE_SECURE, true);
const allowInsecureLocalhost = asBool(process.env.AUTH_ALLOW_INSECURE_LOCALHOST, false);

if (isProduction && !cookieSecure) {
  throw new Error('AUTH_COOKIE_SECURE must be true in production');
}

const defaultAllowedOrigins = [baseUrl];
const configuredAllowedOrigins = splitCsv(process.env.AUTH_ALLOWED_ORIGINS);
const allowedOrigins = configuredAllowedOrigins.length ? configuredAllowedOrigins : defaultAllowedOrigins;

type SameSite = 'lax' | 'none' | 'strict';

const sameSiteRaw = (process.env.AUTH_COOKIE_SAME_SITE || 'none').trim().toLowerCase();
if (!['lax', 'none', 'strict'].includes(sameSiteRaw)) {
  throw new Error('AUTH_COOKIE_SAME_SITE must be one of: lax, none, strict');
}

export interface AuthConfig {
  nodeEnv: string;
  isProduction: boolean;
  isDevelopment: boolean;
  host: string;
  port: number;
  baseUrl: string;
  trustProxy: boolean;
  cookie: {
    name: string;
    domain?: string;
    secure: boolean;
    sameSite: SameSite;
    allowInsecureLocalhost: boolean;
  };
  session: {
    ttlSec: number;
    idleTtlSec: number;
    secret: string;
  };
  bcryptRounds: number;
  rateLimit: {
    windowMs: number;
    loginMax: number;
    registerMax: number;
    oauthMax: number;
  };
  oauth: {
    codeTtlSec: number;
    accessTokenTtlSec: number;
  };
  db: {
    connectionString: string;
    ssl: boolean;
  };
  tenantPolicy: {
    url?: string;
    token?: string;
    timeoutMs: number;
    requireRemote: boolean;
  };
  bootstrap: {
    onStart: boolean;
  };
  allowedOrigins: string[];
  migrationDir: string;
}

export const config: AuthConfig = {
  nodeEnv,
  isProduction,
  isDevelopment,
  host,
  port,
  baseUrl,
  trustProxy: asBool(process.env.AUTH_TRUST_PROXY, false),
  cookie: {
    name: (process.env.AUTH_COOKIE_NAME || '').trim() || 'idp_auth_session',
    domain: (process.env.AUTH_COOKIE_DOMAIN || '').trim() || undefined,
    secure: cookieSecure,
    sameSite: sameSiteRaw as SameSite,
    allowInsecureLocalhost,
  },
  session: {
    ttlSec: asInt(process.env.AUTH_SESSION_TTL_SEC, 8 * 60 * 60, 300, 7 * 24 * 60 * 60),
    idleTtlSec: asInt(process.env.AUTH_SESSION_IDLE_TTL_SEC, 30 * 60, 60, 24 * 60 * 60),
    secret: (process.env.AUTH_SESSION_SECRET || '').trim(),
  },
  bcryptRounds: asInt(process.env.AUTH_BCRYPT_ROUNDS, 12, 10, 14),
  rateLimit: {
    windowMs: asInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 60_000, 10_000, 10 * 60_000),
    loginMax: asInt(process.env.AUTH_RATE_LIMIT_LOGIN_MAX, 20, 3, 500),
    registerMax: asInt(process.env.AUTH_RATE_LIMIT_REGISTER_MAX, 10, 1, 300),
    oauthMax: asInt(process.env.AUTH_RATE_LIMIT_OAUTH_MAX, 120, 10, 1000),
  },
  oauth: {
    codeTtlSec: asInt(process.env.AUTH_CODE_TTL_SEC, 300, 60, 3600),
    accessTokenTtlSec: asInt(process.env.AUTH_ACCESS_TOKEN_TTL_SEC, 3600, 60, 24 * 3600),
  },
  db: {
    connectionString: (process.env.DATABASE_URL || '').trim(),
    ssl: asBool(process.env.AUTH_DB_SSL, false),
  },
  tenantPolicy: {
    url: (process.env.AUTH_TENANT_POLICY_URL || '').trim() || undefined,
    token: (process.env.AUTH_TENANT_POLICY_TOKEN || '').trim() || undefined,
    timeoutMs: asInt(process.env.AUTH_TENANT_POLICY_TIMEOUT_MS, 3000, 500, 10000),
    requireRemote: asBool(process.env.AUTH_TENANT_POLICY_REQUIRE_REMOTE, false),
  },
  bootstrap: {
    onStart: asBool(process.env.AUTH_BOOTSTRAP_ON_START, !isProduction),
  },
  allowedOrigins,
  migrationDir: path.resolve(__dirname, '..', 'migrations'),
};

if (!config.session.secret || config.session.secret.length < 32) {
  throw new Error('AUTH_SESSION_SECRET must be set and at least 32 characters');
}

if (config.cookie.name.startsWith('__Host-') && config.cookie.domain) {
  throw new Error('AUTH_COOKIE_NAME with "__Host-" prefix cannot be used with AUTH_COOKIE_DOMAIN');
}

if (!config.db.connectionString) {
  throw new Error('DATABASE_URL must be configured for auth service');
}

if (config.tenantPolicy.requireRemote && !config.tenantPolicy.url) {
  throw new Error('AUTH_TENANT_POLICY_URL must be configured when AUTH_TENANT_POLICY_REQUIRE_REMOTE=true');
}
