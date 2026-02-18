const SHARED_PROJECT_DEFAULT_VERSION = '1.0.0';

export const normalizeModuleExtension = (raw: unknown): string => {
  const allowed = new Set(['js']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'js';
};

const ensureModelPath = (value: string) => {
  const extMatch = value.match(/\.([^.\/]+)$/);
  if (!extMatch) return `${value}.js`;
  const ext = extMatch[1]?.toLowerCase();
  if (ext !== 'js') {
    return value.replace(/\.[^.\/]+$/, '.js');
  }
  return value;
};

export const normalizeModelPath = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('path is required');
  }
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  return ensureModelPath(trimmed);
};

export const normalizeModelExtension = (raw: unknown): string => {
  const allowed = new Set(['js']);
  if (!raw || typeof raw !== 'string') return 'js';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  if (!allowed.has(normalized)) {
    throw new Error('Only .js model files are supported.');
  }
  return normalized;
};

export const normalizeUiExtension = (raw: unknown): string => {
  const allowed = new Set(['jsx', 'js', 'json', 'css']);
  if (!raw || typeof raw !== 'string') return 'jsx';
  const normalized = raw.replace(/^\./, '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'jsx';
};

export const normalizeSharedPath = (raw: unknown): string => {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('path is required');
  return raw.trim().replace(/\\/g, '/');
};

export const normalizeSharedProjectVersion = (raw: unknown): string => {
  if (raw === undefined || raw === null || raw === '') return SHARED_PROJECT_DEFAULT_VERSION;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('version must be a non-empty string');
  }
  return raw.trim();
};

export const normalizeSharedExtension = (path: string, raw?: unknown): string => {
  const normalize = (value: string) => {
    const cleaned = value.replace(/^\./, '').toLowerCase();
    if (cleaned === 'ts') return 'js';
    if (cleaned === 'tsx') return 'jsx';
    return cleaned;
  };
  if (typeof raw === 'string' && raw.trim()) {
    return normalize(raw);
  }
  const ext = path.split('.').pop();
  return ext ? normalize(ext) : 'jsx';
};
