import { Request } from 'express';

export const optionalString = (value: unknown, max = 2048): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, max);
};

export const optionalTenantOrgRandId = (value: unknown): string => {
  return optionalString(value, 64);
};

export const readEntityTenantOrgRandId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { tenantOrgRandId?: unknown }).tenantOrgRandId;
  const normalized = optionalTenantOrgRandId(raw);
  return normalized || null;
};

export const appendQuery = (url: string, key: string, value: string | null | undefined): string => {
  if (!value) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

export const appendAuthContext = (
  baseUrl: string,
  {
    returnTo,
    clientId,
    tenantName,
    tenantOrgRandId,
  }: {
    returnTo: string;
    clientId?: string;
    tenantName?: string;
    tenantOrgRandId?: string;
  },
): string => {
  let location = `${baseUrl}?returnTo=${encodeURIComponent(returnTo)}`;
  if (clientId) location = appendQuery(location, 'client_id', clientId);
  if (tenantName) location = appendQuery(location, 'tenant_name', tenantName);
  if (tenantOrgRandId) location = appendQuery(location, 'tenant_org_id', tenantOrgRandId);
  return location;
};

export const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return fallback;
};

export const toLoginFriendlyError = (message: string): string => {
  const normalized = String(message || '').trim().toLowerCase();
  if (
    normalized.includes('tenant_name must match redirect_uri host tenant') ||
    normalized.includes('tenant callback is not mapped to this oauth client') ||
    normalized.includes('tenant callback host is not whitelisted') ||
    normalized.includes('tenant is not mapped to this oauth client') ||
    normalized.includes('tenant is not whitelisted for sso')
  ) {
    return 'Tenant configuration mismatch. Start sign in again from the same tenant URL.';
  }
  return message;
};

export const encodeErrorParam = (error: unknown): string => {
  return encodeURIComponent(toErrorMessage(error, 'Unexpected error'));
};

export const hostFromAbsoluteUrl = (value: string): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname || null;
  } catch {
    return null;
  }
};

export const hostFromOriginHeader = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return hostFromAbsoluteUrl(value);
};

export const tenantHostFromReturnTo = (returnTo: string): string | null => {
  if (!returnTo || !returnTo.startsWith('/')) return null;
  try {
    const parsed = new URL(returnTo, 'http://local.auth');
    const redirectUri = parsed.searchParams.get('redirect_uri') || '';
    return hostFromAbsoluteUrl(redirectUri);
  } catch {
    return null;
  }
};

export const resolveTenantHostForCookie = (req: Request, returnTo?: string): string | null => {
  const tenantName = optionalString(req.body.tenant_name || req.query.tenant_name, 255);
  if (tenantName) return tenantName;

  const redirectUri =
    optionalString(req.body.redirect_uri || req.query.redirect_uri, 2048) ||
    optionalString(req.body.callback_url || req.query.callback_url, 2048);
  const fromRedirect = hostFromAbsoluteUrl(redirectUri);
  if (fromRedirect) return fromRedirect;

  const fromReturnTo = returnTo ? tenantHostFromReturnTo(returnTo) : null;
  if (fromReturnTo) return fromReturnTo;

  const fromOrigin = hostFromOriginHeader(req.headers.origin);
  if (fromOrigin) return fromOrigin;

  const fromReferer = hostFromOriginHeader(req.headers.referer);
  return fromReferer || null;
};

export const wantsJson = (req: Request): boolean => {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('application/json')) return true;
  const accept = String(req.headers.accept || '');
  return accept.includes('application/json');
};
