const fs = require('fs');
const path = require('path');

const pickEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== 'string') continue;
    if (!value.trim()) continue;
    return value.trim();
  }
  return '';
};

const asBool = (value, fallback = false) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseIntBounded = (value, fallback, min, max) => {
  if (typeof value === 'string' && !value.trim()) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
};

const parseCsvList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const resolvePathSafe = (value, cwd) =>
  path.isAbsolute(value) ? value : path.resolve(cwd, value);

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const sanitizeSegment = (value, max = 48) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, max);

const hashText = (value) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

module.exports = {
  pickEnv,
  asBool,
  parseIntBounded,
  parseCsvList,
  normalizeUrl,
  resolvePathSafe,
  ensureDir,
  sanitizeSegment,
  hashText,
};
