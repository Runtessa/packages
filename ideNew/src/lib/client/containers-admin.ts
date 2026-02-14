import { fetchJson } from '@/lib/client/api';

export type AdminUser = {
  id: number;
  email: string;
  role: string;
};

export type ServiceRecord = {
  key: string;
  userScoped?: boolean;
  managed?: boolean;
};

export type ServiceState = {
  service?: string;
  userKey?: string;
  containerName?: string;
  engine?: string;
  image?: string;
  exists?: boolean;
  running?: boolean;
  port?: number | null;
  host?: string;
  baseUrl?: string;
};

export type ServiceStateRow = {
  service: string;
  userScoped: boolean;
  managed: boolean;
  state: ServiceState | null;
  error: string | null;
};

export type ContainerRow = {
  id: string;
  names?: string[];
  image?: string;
  imageId?: string;
  command?: string;
  created?: number;
  state?: string;
  status?: string;
  labels?: Record<string, string>;
  ports?: Array<Record<string, unknown>>;
};

export type RuntimePayload = {
  configured?: boolean;
  managerVersion?: {
    ok?: boolean;
    service?: string;
    version?: string;
    startedAt?: string;
    now?: string;
    error?: string;
  } | null;
  services?: ServiceRecord[];
  states?: ServiceStateRow[];
  containers?: ContainerRow[];
  selectedUser?: {
    userId?: string;
    userName?: string;
  };
};

export const fetchRuntime = async (
  token: string,
  selected?: { userId?: string; userName?: string }
) => {
  const qs = new URLSearchParams();
  if (selected?.userId) qs.set('userId', selected.userId);
  if (selected?.userName) qs.set('userName', selected.userName);
  return (await fetchJson(
    `/api/admin/containers/runtime${qs.toString() ? `?${qs.toString()}` : ''}`,
    { token }
  )) as RuntimePayload;
};

export const fetchAdminUsers = async (token: string) => {
  const data = await fetchJson('/api/users?page=1&limit=100', { token });
  const rows = Array.isArray(data?.users) ? data.users : [];
  return rows
    .map((entry: any) => ({
      id: Number(entry?.id),
      email: String(entry?.email || ''),
      role: String(entry?.role || ''),
    }))
    .filter((entry: AdminUser) => Number.isFinite(entry.id) && Boolean(entry.email));
};

export const runServiceAction = async (
  token: string,
  input: {
    service: string;
    action: 'create' | 'start' | 'stop' | 'restart' | 'remove';
    userId?: string;
    userName?: string;
    preferredPort?: number;
  }
) =>
  fetchJson('/api/admin/containers/service-action', {
    method: 'POST',
    token,
    body: input,
  });

export const listContainers = async (
  token: string,
  options?: { managedOnly?: boolean; service?: string; search?: string }
) => {
  const qs = new URLSearchParams({
    managedOnly: String(options?.managedOnly ?? true),
  });
  if (options?.service) qs.set('service', options.service);
  if (options?.search) qs.set('search', options.search);
  const data = await fetchJson(`/api/admin/containers/list?${qs.toString()}`, { token });
  return {
    total: Number(data?.total || 0),
    managedOnly: Boolean(data?.managedOnly),
    containers: Array.isArray(data?.containers) ? (data.containers as ContainerRow[]) : [],
  };
};

export const runContainerAction = async (
  token: string,
  input: { containerName: string; action: 'start' | 'stop' | 'restart' | 'remove' }
) =>
  fetchJson('/api/admin/containers/container-action', {
    method: 'POST',
    token,
    body: input,
  });

export const inspectContainer = async (token: string, containerName: string) =>
  fetchJson(`/api/admin/containers/inspect?containerName=${encodeURIComponent(containerName)}`, {
    token,
  });

export const fetchContainerLogs = async (
  token: string,
  input: { containerName: string; tail?: number; since?: number }
) => {
  const qs = new URLSearchParams({
    containerName: input.containerName,
    tail: String(input.tail || 200),
  });
  if (Number.isFinite(Number(input.since)) && Number(input.since) > 0) {
    qs.set('since', String(Math.floor(Number(input.since))));
  }
  return fetchJson(`/api/admin/containers/logs?${qs.toString()}`, { token });
};

export const createContainer = async (
  token: string,
  input: {
    image: string;
    name?: string;
    env?: string[];
    envMap?: Record<string, string>;
    binds?: string[];
    ports?: Array<{ containerPort: number; hostPort?: number; protocol?: 'tcp' | 'udp' }>;
    cmd?: string[];
    entrypoint?: string[];
    restartPolicy?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
    autoStart?: boolean;
    managed?: boolean;
    labels?: Record<string, string>;
  }
) =>
  fetchJson('/api/admin/containers/create', {
    method: 'POST',
    token,
    body: input,
  });
