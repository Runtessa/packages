const ROLE_CODE_PATTERN = /^[a-z0-9]+(?::[a-z0-9._-]+)+$/i;

export const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const normalizeText = (value: unknown, label: string, max: number): string => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    const error = new Error(`${label} is required`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  if (normalized.length > max) {
    const error = new Error(`${label} is too long`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

export const normalizeRoleCode = (value: unknown): string => {
  const normalized = normalizeText(value, 'role_code', 96).toLowerCase();
  if (!ROLE_CODE_PATTERN.test(normalized)) {
    const error = new Error('role_code must be nominal and colon-separated (example: sales:manager)') as Error & {
      statusCode?: number;
    };
    error.statusCode = 400;
    throw error;
  }
  return normalized;
};

export const toBool = (value: unknown, fallback = true): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

export const normalizePage = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};
