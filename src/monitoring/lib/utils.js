const {
  MONITORING_SCOPE_OPTIONS,
  MONITORING_OPERATOR_OPTIONS,
  MONITORING_SEVERITY_OPTIONS,
  MONITORING_METRIC_OPTIONS,
} = require('./constants');

const asBearer = (header) => {
  if (!header || typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const expectedToken = () =>
  (process.env.MONITORING_INGEST_TOKEN || process.env.MONITORING_SERVER_TOKEN || '').trim();

const requireAuth = (req, res) => {
  const token = expectedToken();
  if (!token) return true;
  const provided = asBearer(req.headers.authorization);
  if (provided && provided === token) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
};

const asBool = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseIntBounded = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toMinutes = (value) => {
  const parsed = toNumber(Array.isArray(value) ? value[0] : value, 60);
  return Math.min(Math.max(Math.floor(parsed), 5), 24 * 60);
};

const toLimit = (value, fallback, max) => {
  const parsed = toNumber(Array.isArray(value) ? value[0] : value, fallback);
  return Math.min(Math.max(Math.floor(parsed), 1), max);
};

const toPage = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  return Math.max(Math.floor(toNumber(raw, 1)), 1);
};

const str = (value) => {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
};

const normalizeInstanceName = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const normalizeTenantHostname = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const isObject = (value) => Boolean(value) && typeof value === 'object';

const parseJson = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const parseHeaders = (raw) => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k), String(v)]));
  }
  return null;
};

const isMonitoringScope = (value) => MONITORING_SCOPE_OPTIONS.includes(value);
const isMonitoringOperator = (value) => MONITORING_OPERATOR_OPTIONS.includes(value);
const isMonitoringSeverity = (value) => MONITORING_SEVERITY_OPTIONS.includes(value);
const isMonitoringMetric = (value) => MONITORING_METRIC_OPTIONS.some((item) => item.value === value);

module.exports = {
  asBearer,
  expectedToken,
  requireAuth,
  asBool,
  parseIntBounded,
  toNumber,
  toMinutes,
  toLimit,
  toPage,
  str,
  normalizeInstanceName,
  normalizeTenantHostname,
  isObject,
  parseJson,
  parseHeaders,
  isMonitoringScope,
  isMonitoringOperator,
  isMonitoringSeverity,
  isMonitoringMetric,
};
