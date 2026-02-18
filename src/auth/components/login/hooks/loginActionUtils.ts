import { OTP_PROGRESS_STORAGE_KEY, OtpProgressState, parseJsonSafe } from '../config';

export const clearOtpProgress = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(OTP_PROGRESS_STORAGE_KEY);
};

export const persistOtpProgress = (payload: OtpProgressState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OTP_PROGRESS_STORAGE_KEY, JSON.stringify(payload));
};

export const createServerErrorMapper = (tenantMismatchMessage: string) => {
  return (value: unknown, fallback: string): string => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const normalized = raw.toLowerCase();
    if (
      normalized.includes('tenant_name must match redirect_uri host tenant') ||
      normalized.includes('tenant callback is not mapped to this oauth client') ||
      normalized.includes('tenant callback host is not whitelisted') ||
      normalized.includes('tenant is not mapped to this oauth client') ||
      normalized.includes('tenant is not whitelisted for sso') ||
      normalized.includes('tenant configuration mismatch')
    ) {
      return tenantMismatchMessage;
    }
    return raw;
  };
};

export const postJson = async (
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await parseJsonSafe(res);
  return { ok: res.ok, status: res.status, data };
};
