import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';

type AdminUser = {
  id: number;
  email: string;
  role: string;
};

type ServiceRecord = {
  key: string;
  userScoped?: boolean;
  managed?: boolean;
};

type ServiceState = {
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

type ServiceStateRow = {
  service: string;
  userScoped: boolean;
  managed: boolean;
  state: ServiceState | null;
  error: string | null;
};

type ManagedContainer = {
  id: string;
  names?: string[];
  image?: string;
  state?: string;
  status?: string;
  labels?: Record<string, string>;
  ports?: Array<Record<string, unknown>>;
};

type RuntimePayload = {
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
  containers?: ManagedContainer[];
  selectedUser?: {
    userId?: string;
    userName?: string;
  };
};

const SERVICE_ACTIONS: Array<'create' | 'start' | 'stop' | 'restart' | 'remove'> = [
  'create',
  'start',
  'stop',
  'restart',
  'remove',
];

const CONTAINER_ACTIONS: Array<'start' | 'stop' | 'restart' | 'remove'> = [
  'start',
  'stop',
  'restart',
  'remove',
];

const asName = (names?: string[]) => String(names?.[0] || '').replace(/^\/+/, '');

const formatPorts = (ports: Array<Record<string, unknown>> | undefined) => {
  if (!Array.isArray(ports) || ports.length === 0) return '-';
  return ports
    .map((port) => {
      const publicPort = Number(port.PublicPort);
      const privatePort = Number(port.PrivatePort);
      const type = String(port.Type || 'tcp');
      if (Number.isFinite(publicPort) && Number.isFinite(privatePort)) {
        return `${publicPort}:${privatePort}/${type}`;
      }
      return `${Number.isFinite(privatePort) ? privatePort : '?'} / ${type}`;
    })
    .join(', ');
};

export default function AdminContainersPage() {
  const router = useRouter();
  const { token, setToken, ready } = useSessionToken();

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [configured, setConfigured] = useState(true);
  const [managerVersion, setManagerVersion] = useState<RuntimePayload['managerVersion']>(null);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [states, setStates] = useState<ServiceStateRow[]>([]);
  const [containers, setContainers] = useState<ManagedContainer[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedUserName, setSelectedUserName] = useState('');

  const sortedStates = useMemo(
    () =>
      [...states].sort((a, b) => {
        if (a.service === 'codex-gateway') return -1;
        if (b.service === 'codex-gateway') return 1;
        if (a.service === 'monitoring') return -1;
        if (b.service === 'monitoring') return 1;
        return a.service.localeCompare(b.service);
      }),
    [states]
  );

  const loadRuntime = async (options?: { silent?: boolean; userId?: string; userName?: string }) => {
    if (!token) return;
    if (!options?.silent) setLoading(true);
    if (!options?.silent) setError('');
    try {
      const targetUserId = options?.userId ?? selectedUserId;
      const targetUserName = options?.userName ?? selectedUserName;
      const qs = new URLSearchParams();
      if (targetUserId) qs.set('userId', targetUserId);
      if (targetUserName) qs.set('userName', targetUserName);
      const url = `/api/admin/containers/runtime${qs.toString() ? `?${qs.toString()}` : ''}`;
      const payload = await fetchJson(url, { token });
      const data = (payload || {}) as RuntimePayload;
      setConfigured(Boolean(data.configured));
      setManagerVersion(data.managerVersion || null);
      setServices(Array.isArray(data.services) ? data.services : []);
      setStates(Array.isArray(data.states) ? data.states : []);
      setContainers(Array.isArray(data.containers) ? data.containers : []);

      const nextUserId = String(data.selectedUser?.userId || targetUserId || '');
      const nextUserName = String(data.selectedUser?.userName || targetUserName || '');
      if (nextUserId !== selectedUserId) setSelectedUserId(nextUserId);
      if (nextUserName !== selectedUserName) setSelectedUserName(nextUserName);
    } catch (err: any) {
      setError(err.message || 'Failed to load container runtime');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  const loadUsers = async () => {
    if (!token) return;
    try {
      const data = await fetchJson('/api/users?page=1&limit=100', { token });
      const list = Array.isArray(data?.users) ? data.users : [];
      setUsers(
        list
          .map((entry: any) => ({
            id: Number(entry?.id),
            email: String(entry?.email || ''),
            role: String(entry?.role || ''),
          }))
          .filter((entry: AdminUser) => Number.isFinite(entry.id) && entry.email)
      );
    } catch {
      setUsers([]);
    }
  };

  useEffect(() => {
    const boot = async () => {
      if (!ready || !token) return;
      try {
        const meRes = await fetch('/api/me', { headers: { Authorization: `Session ${token}` } });
        const meData = await meRes.json();
        if (!meRes.ok) throw new Error(meData.error || 'Failed to load user');
        if (meData?.user?.role !== 'admin') {
          router.replace('/dashboard');
          return;
        }
        const defaultUserId = String(meData?.user?.id || '');
        const defaultUserName = String(meData?.user?.email || '');
        setSelectedUserId(defaultUserId);
        setSelectedUserName(defaultUserName);
        await Promise.all([
          loadUsers(),
          loadRuntime({ userId: defaultUserId, userName: defaultUserName }),
        ]);
      } catch (err: any) {
        setError(err.message || 'Failed to load container controls');
        if (err.message?.toLowerCase().includes('unauthorized')) {
          setToken('');
        }
      }
    };
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token]);

  const runServiceAction = async (
    service: string,
    action: 'create' | 'start' | 'stop' | 'restart' | 'remove',
    userScoped: boolean
  ) => {
    if (!token) return;
    setBusyKey(`service:${service}:${action}`);
    setError('');
    setSuccess('');
    try {
      await fetchJson('/api/admin/containers/service-action', {
        method: 'POST',
        token,
        body: {
          service,
          action,
          ...(userScoped
            ? {
                userId: selectedUserId,
                userName: selectedUserName,
              }
            : {}),
        },
      });
      setSuccess(`Service ${service}: ${action} completed`);
      await loadRuntime({ silent: true });
    } catch (err: any) {
      setError(err.message || `Failed to ${action} service ${service}`);
    } finally {
      setBusyKey('');
    }
  };

  const runContainerAction = async (
    containerName: string,
    action: 'start' | 'stop' | 'restart' | 'remove'
  ) => {
    if (!token) return;
    setBusyKey(`container:${containerName}:${action}`);
    setError('');
    setSuccess('');
    try {
      await fetchJson('/api/admin/containers/container-action', {
        method: 'POST',
        token,
        body: { containerName, action },
      });
      setSuccess(`Container ${containerName}: ${action} completed`);
      await loadRuntime({ silent: true });
    } catch (err: any) {
      setError(err.message || `Failed to ${action} container ${containerName}`);
    } finally {
      setBusyKey('');
    }
  };

  const applyUserSelection = async () => {
    await loadRuntime({ userId: selectedUserId, userName: selectedUserName });
  };

  if (ready && !token) {
    return (
      <div className="min-h-screen bg-bgApp px-4 py-10 text-left text-textPrimary">
        <div className="mx-auto w-full max-w-md space-y-3 rounded-xl border border-borderSubtle bg-bgSurface p-6 shadow-soft">
          <h2 className="text-xl font-semibold">Please log in</h2>
          <p className="text-sm text-textMuted">
            Your session expired or is missing. <a href="/login" className="text-accent">Go to login</a>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Container Manager"
        subtitle="Manage codex-gateway, monitoring, and other managed runtime containers."
        actions={
          <Button variant="secondary" onClick={() => void loadRuntime()}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-accent bg-bgApp px-4 py-3 text-sm text-accent">
          {success}
        </div>
      )}

      {!configured ? (
        <DataCard
          title="Container manager not configured"
          subtitle="Set AGENT_CONTAINER_MANAGER_URL and AGENT_CONTAINER_MANAGER_TOKEN in IDE env."
        >
          <p className="text-sm text-textMuted">
            Once configured, this panel can manage runtime services without direct Docker/Podman
            socket access from IDE.
          </p>
        </DataCard>
      ) : (
        <>
          <DataCard title="Manager Runtime" subtitle="Remote control-plane status">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
                <div className="text-xs uppercase text-textMuted">Service</div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {managerVersion?.service || 'idp-container-manager'}
                </div>
              </div>
              <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
                <div className="text-xs uppercase text-textMuted">Version</div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {managerVersion?.version || '-'}
                </div>
              </div>
              <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
                <div className="text-xs uppercase text-textMuted">Started</div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {managerVersion?.startedAt
                    ? new Date(managerVersion.startedAt).toLocaleString()
                    : '-'}
                </div>
              </div>
            </div>
            {'error' in (managerVersion || {}) && managerVersion?.error ? (
              <p className="mt-3 text-sm text-amber-400">{managerVersion.error}</p>
            ) : null}
          </DataCard>

          <DataCard
            title="Codex User Scope"
            subtitle="codex-gateway service is user-scoped. Choose which user context to control."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-textMuted">Known users</label>
                <select
                  className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
                  value={`${selectedUserId}|${selectedUserName}`}
                  onChange={(event) => {
                    const [id, email] = String(event.target.value || '').split('|');
                    if (id) setSelectedUserId(id);
                    if (email) setSelectedUserName(email);
                  }}
                >
                  {users.length === 0 ? (
                    <option value={`${selectedUserId}|${selectedUserName}`}>Current user</option>
                  ) : null}
                  {users.map((user) => (
                    <option key={user.id} value={`${user.id}|${user.email}`}>
                      {user.email} ({user.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-textMuted">User ID</label>
                <input
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-textMuted">User Name / Email</label>
                <input
                  value={selectedUserName}
                  onChange={(event) => setSelectedUserName(event.target.value)}
                  className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void applyUserSelection()}>
                Apply user scope
              </Button>
            </div>
          </DataCard>

          <DataCard title="Services" subtitle="Managed runtime services from container-manager">
            <DataTable headers={['Service', 'Container', 'State', 'Runtime', 'Actions']} loading={loading}>
              {sortedStates.map((row) => {
                const state = row.state;
                const stateText = state
                  ? state.running
                    ? 'running'
                    : state.exists
                      ? 'stopped'
                      : 'not created'
                  : row.error
                    ? 'error'
                    : 'unknown';
                return (
                  <tr key={row.service} className="hover:bg-bgApp transition">
                    <td className="px-4 py-3 text-textPrimary">
                      <div className="font-semibold">{row.service}</div>
                      {row.userScoped ? (
                        <div className="text-xs text-textMuted">
                          user-scoped ({selectedUserName || selectedUserId || '-'})
                        </div>
                      ) : (
                        <div className="text-xs text-textMuted">global service</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-textMuted">
                      {state?.containerName || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                          stateText === 'running'
                            ? 'border-accent/50 text-accent'
                            : stateText === 'stopped'
                              ? 'border-amber-500/40 text-amber-300'
                              : stateText === 'error'
                                ? 'border-danger/40 text-danger'
                                : 'border-borderSubtle text-textMuted'
                        }`}
                      >
                        {stateText}
                      </span>
                      {row.error ? (
                        <div className="mt-1 max-w-[420px] break-words text-xs text-danger">
                          {row.error}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-textMuted">
                      <div>engine: {state?.engine || '-'}</div>
                      <div>image: {state?.image || '-'}</div>
                      <div>port: {state?.port ?? '-'}</div>
                      {state?.baseUrl ? (
                        <div className="max-w-[260px] truncate text-accent">
                          <a href={state.baseUrl} target="_blank" rel="noreferrer">
                            {state.baseUrl}
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {SERVICE_ACTIONS.map((action) => {
                          const actionKey = `service:${row.service}:${action}`;
                          return (
                            <Button
                              key={action}
                              variant="secondary"
                              size="xs"
                              disabled={Boolean(busyKey)}
                              onClick={() => void runServiceAction(row.service, action, row.userScoped)}
                            >
                              {busyKey === actionKey ? `${action}...` : action}
                            </Button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </DataCard>

          <DataCard title="Managed Containers" subtitle="Container-level controls (managed only)">
            <DataTable
              headers={['Name', 'Service', 'Image', 'Status', 'Ports', 'Actions']}
              loading={loading}
            >
              {containers.map((container) => {
                const containerName = asName(container.names);
                const service = String(container.labels?.['idp.service'] || '-');
                return (
                  <tr key={container.id} className="hover:bg-bgApp transition">
                    <td className="px-4 py-3 text-textPrimary">
                      <div className="font-medium">{containerName || '-'}</div>
                      <div className="text-xs text-textMuted">{container.id.slice(0, 12)}</div>
                    </td>
                    <td className="px-4 py-3 text-textMuted">{service}</td>
                    <td className="px-4 py-3 text-textMuted">{container.image || '-'}</td>
                    <td className="px-4 py-3 text-textMuted">
                      <div>{container.state || '-'}</div>
                      <div className="text-xs">{container.status || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-textMuted">{formatPorts(container.ports)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {CONTAINER_ACTIONS.map((action) => {
                          const actionKey = `container:${containerName}:${action}`;
                          return (
                            <Button
                              key={action}
                              variant="secondary"
                              size="xs"
                              disabled={Boolean(busyKey) || !containerName}
                              onClick={() => void runContainerAction(containerName, action)}
                            >
                              {busyKey === actionKey ? `${action}...` : action}
                            </Button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          </DataCard>
        </>
      )}
    </div>
  );
}
