import { useCallback } from 'react';
import { getSelectedTenantHost } from '@/lib/client/tenant';

type ApiOptions = {
  method?: string;
  body?: unknown;
};

type ApiStreamOptions = ApiOptions & {
  signal?: AbortSignal;
};

type UseEditorApiParams = {
  coreApiBase: string;
  token: string;
  clearSession: () => void;
};

export const useEditorApi = ({ coreApiBase, token, clearSession }: UseEditorApiParams) => {
  const resolveApiUrl = useCallback(
    (url: string) => {
      if (/^https?:\/\//i.test(url)) return url;
      if (!coreApiBase) return url;
      const base = coreApiBase.replace(/\/$/, '');
      return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
    },
    [coreApiBase],
  );

  const apiFetch = useCallback(
    async (url: string, options: ApiOptions = {}) => {
      if (!token) {
        const err = new Error('Session token is missing');
        (err as any).statusCode = 401;
        throw err;
      }
      const tenantHost = getSelectedTenantHost();
      if (!tenantHost) {
        const err = new Error('Select a tenant in /admin/tenants to use the editor.');
        (err as any).statusCode = 400;
        throw err;
      }
      const res = await fetch(resolveApiUrl(url), {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(tenantHost ? { 'X-Tenant-Host': tenantHost } : {}),
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        if (res.status === 401) {
          clearSession();
        }
        throw new Error(data.error || 'Request failed');
      }
      return data;
    },
    [clearSession, resolveApiUrl, token],
  );

  const apiStreamFetch = useCallback(
    async (url: string, options: ApiStreamOptions = {}) => {
      if (!token) {
        const err = new Error('Session token is missing');
        (err as any).statusCode = 401;
        throw err;
      }
      const tenantHost = getSelectedTenantHost();
      if (!tenantHost) {
        const err = new Error('Select a tenant in /admin/tenants to use the editor.');
        (err as any).statusCode = 400;
        throw err;
      }
      const res = await fetch(resolveApiUrl(url), {
        method: options.method ?? 'GET',
        signal: options.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(tenantHost ? { 'X-Tenant-Host': tenantHost } : {}),
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearSession();
        }
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        throw new Error(data.error || 'Request failed');
      }
      return res;
    },
    [clearSession, resolveApiUrl, token],
  );

  const adminFetch = useCallback(
    async (url: string, options: ApiOptions = {}) => {
      if (!token) {
        const err = new Error('Session token is missing');
        (err as any).statusCode = 401;
        throw err;
      }
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Session ${token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (!res.ok) {
        if (res.status === 401) {
          clearSession();
        }
        throw new Error(data.error || 'Request failed');
      }
      return data;
    },
    [clearSession, token],
  );

  return { resolveApiUrl, apiFetch, apiStreamFetch, adminFetch };
};
