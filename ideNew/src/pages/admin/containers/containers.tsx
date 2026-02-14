import { useEffect, useMemo, useState } from 'react';
import ContainerManagerLayout from '@/components/containers/ContainerManagerLayout';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import {
  createContainer,
  fetchContainerLogs,
  fetchRuntime,
  inspectContainer,
  listContainers,
  runContainerAction,
  type ContainerRow,
  type RuntimePayload,
} from '@/lib/client/containers-admin';
import { useAdminGuard } from '@/lib/client/use-admin-guard';

const CONTAINER_ACTIONS: Array<'start' | 'stop' | 'restart' | 'remove'> = [
  'start',
  'stop',
  'restart',
  'remove',
];

const asName = (names?: string[]) => String(names?.[0] || '').replace(/^\/+/, '');

const parseLineList = (input: string) =>
  input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const parsePortsInput = (input: string) => {
  const lines = parseLineList(input);
  const result: Array<{ containerPort: number; hostPort?: number; protocol?: 'tcp' | 'udp' }> = [];
  lines.forEach((line) => {
    // accepted formats:
    // 8080
    // 3000:8080
    // 3000:8080/tcp
    // 8080/udp
    const match = line.match(/^((\d+):)?(\d+)(\/(tcp|udp))?$/i);
    if (!match) return;
    const hostPort = match[2] ? Number(match[2]) : undefined;
    const containerPort = Number(match[3]);
    const protocol = (match[5]?.toLowerCase() || 'tcp') as 'tcp' | 'udp';
    if (!Number.isFinite(containerPort) || containerPort < 1 || containerPort > 65535) return;
    if (hostPort !== undefined && (!Number.isFinite(hostPort) || hostPort < 1 || hostPort > 65535)) {
      return;
    }
    result.push({ containerPort, ...(hostPort ? { hostPort } : {}), protocol });
  });
  return result;
};

export default function ContainerContainersPage() {
  const { token, ready, user, isAdmin, loading: authLoading, error: authError } = useAdminGuard('ide.containers.manage');
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [managedOnly, setManagedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');

  const [selectedContainer, setSelectedContainer] = useState('');
  const [inspectData, setInspectData] = useState<Record<string, unknown> | null>(null);
  const [logs, setLogs] = useState('');
  const [logTail, setLogTail] = useState(300);

  const [createImage, setCreateImage] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRestartPolicy, setCreateRestartPolicy] = useState<'no' | 'always' | 'unless-stopped' | 'on-failure'>(
    'unless-stopped'
  );
  const [createAutoStart, setCreateAutoStart] = useState(true);
  const [createManaged, setCreateManaged] = useState(false);
  const [createPorts, setCreatePorts] = useState('');
  const [createEnv, setCreateEnv] = useState('');
  const [createBinds, setCreateBinds] = useState('');
  const [createCmd, setCreateCmd] = useState('');

  const serviceOptions = useMemo(
    () => (runtime?.services || []).map((item) => item.key).sort((a, b) => a.localeCompare(b)),
    [runtime?.services]
  );

  const loadRuntime = async (options?: { silent?: boolean }) => {
    if (!token || !user) return;
    if (!options?.silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await fetchRuntime(token, {
        userId: String(user.id),
        userName: user.email,
      });
      setRuntime(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load runtime');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  const loadContainers = async (options?: { silent?: boolean }) => {
    if (!token) return;
    if (!options?.silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await listContainers(token, {
        managedOnly,
        search: search.trim() || undefined,
        service: serviceFilter || undefined,
      });
      setContainers(data.containers);
    } catch (err: any) {
      setError(err.message || 'Failed to load containers');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !token || !user || !isAdmin) return;
    void Promise.all([loadRuntime(), loadContainers()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, user?.id, isAdmin]);

  useEffect(() => {
    if (!ready || !token || !isAdmin) return;
    void loadContainers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedOnly, serviceFilter]);

  const onContainerAction = async (
    containerName: string,
    action: 'start' | 'stop' | 'restart' | 'remove'
  ) => {
    if (!token) return;
    setBusyKey(`${containerName}:${action}`);
    setError('');
    setSuccess('');
    try {
      await runContainerAction(token, { containerName, action });
      setSuccess(`Container ${containerName}: ${action} completed`);
      await loadContainers({ silent: true });
      if (selectedContainer === containerName) {
        await loadInspect(containerName, { silent: true });
      }
    } catch (err: any) {
      setError(err.message || `Failed to ${action} ${containerName}`);
    } finally {
      setBusyKey('');
    }
  };

  const loadInspect = async (containerName: string, options?: { silent?: boolean }) => {
    if (!token || !containerName) return;
    if (!options?.silent) setBusyKey(`inspect:${containerName}`);
    try {
      const [inspectRes, logsRes] = await Promise.all([
        inspectContainer(token, containerName),
        fetchContainerLogs(token, { containerName, tail: logTail }),
      ]);
      setSelectedContainer(containerName);
      setInspectData((inspectRes?.inspect as Record<string, unknown>) || null);
      setLogs(String(logsRes?.logs || ''));
    } catch (err: any) {
      setError(err.message || `Failed to inspect ${containerName}`);
    } finally {
      if (!options?.silent) setBusyKey('');
    }
  };

  const refreshLogs = async () => {
    if (!token || !selectedContainer) return;
    setBusyKey(`logs:${selectedContainer}`);
    try {
      const data = await fetchContainerLogs(token, {
        containerName: selectedContainer,
        tail: logTail,
      });
      setLogs(String(data?.logs || ''));
    } catch (err: any) {
      setError(err.message || 'Failed to refresh logs');
    } finally {
      setBusyKey('');
    }
  };

  const onCreate = async () => {
    if (!token) return;
    if (!createImage.trim()) {
      setError('Image is required');
      return;
    }
    setBusyKey('create');
    setError('');
    setSuccess('');
    try {
      const envLines = parseLineList(createEnv);
      const envMap: Record<string, string> = {};
      envLines.forEach((line) => {
        const sepIndex = line.indexOf('=');
        if (sepIndex < 1) return;
        const key = line.slice(0, sepIndex).trim();
        const value = line.slice(sepIndex + 1);
        if (!key) return;
        envMap[key] = value;
      });
      const cmd = parseLineList(createCmd).flatMap((line) =>
        line
          .split(' ')
          .map((part) => part.trim())
          .filter(Boolean)
      );

      const result = await createContainer(token, {
        image: createImage.trim(),
        name: createName.trim() || undefined,
        restartPolicy: createRestartPolicy,
        autoStart: createAutoStart,
        managed: createManaged,
        ports: parsePortsInput(createPorts),
        envMap,
        binds: parseLineList(createBinds),
        ...(cmd.length ? { cmd } : {}),
      });
      setSuccess(`Container created: ${String(result?.containerName || createName || createImage)}`);
      setCreateName('');
      setCreatePorts('');
      setCreateEnv('');
      setCreateBinds('');
      setCreateCmd('');
      await loadContainers({ silent: true });
    } catch (err: any) {
      setError(err.message || 'Failed to create container');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <ContainerManagerLayout
      title="Container Control"
      subtitle="Manual container orchestration: list, inspect, logs, lifecycle, and create."
      onRefresh={() => {
        void loadContainers();
        void loadRuntime({ silent: true });
      }}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadContainers()}>
            Refresh list
          </Button>
        </div>
      }
    >
      {authLoading || loading ? (
        <DataCard title="Loading containers" subtitle="Please wait..." />
      ) : null}

      {authError ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {authError}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-accent bg-bgApp px-4 py-3 text-sm text-accent">
          {success}
        </div>
      ) : null}

      <DataCard title="Filters" subtitle="Scope and search container list">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex items-center gap-2 rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={managedOnly}
              onChange={(event) => setManagedOnly(event.target.checked)}
            />
            Managed only
          </label>
          <div className="space-y-1">
            <label className="text-xs text-textMuted">Service</label>
            <select
              value={serviceFilter}
              onChange={(event) => setServiceFilter(event.target.value)}
              className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
            >
              <option value="">All services</option>
              {serviceOptions.map((service) => (
                <option key={service} value={service}>
                  {service}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs text-textMuted">Search</label>
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="name, image, service..."
                className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
              />
              <Button variant="secondary" size="sm" onClick={() => void loadContainers()}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </DataCard>

      <DataCard title="Containers" subtitle="Lifecycle controls and inspect entrypoint">
        <DataTable headers={['Name', 'Service', 'Image', 'Status', 'Ports', 'Actions']} loading={loading}>
          {containers.map((container) => {
            const containerName = asName(container.names);
            return (
              <tr key={container.id} className="hover:bg-bgApp transition">
                <td className="px-4 py-3 text-textPrimary">
                  <div className="font-medium">{containerName || '-'}</div>
                  <div className="text-xs text-textMuted">{String(container.id || '').slice(0, 12)}</div>
                </td>
                <td className="px-4 py-3 text-textMuted">{String(container.labels?.['idp.service'] || '-')}</td>
                <td className="px-4 py-3 text-textMuted">{String(container.image || '-')}</td>
                <td className="px-4 py-3 text-textMuted">{String(container.status || container.state || '-')}</td>
                <td className="px-4 py-3 text-xs text-textMuted">
                  {(container.ports || [])
                    .map((p) => {
                      const pub = Number((p as any).PublicPort);
                      const priv = Number((p as any).PrivatePort);
                      const typ = String((p as any).Type || 'tcp');
                      if (Number.isFinite(pub) && Number.isFinite(priv)) return `${pub}:${priv}/${typ}`;
                      return Number.isFinite(priv) ? `${priv}/${typ}` : '-';
                    })
                    .join(', ') || '-'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={Boolean(busyKey) || !containerName}
                      onClick={() => void loadInspect(containerName)}
                    >
                      {busyKey === `inspect:${containerName}` ? 'Inspecting...' : 'Inspect'}
                    </Button>
                    {CONTAINER_ACTIONS.map((action) => (
                      <Button
                        key={action}
                        variant="secondary"
                        size="xs"
                        disabled={Boolean(busyKey) || !containerName}
                        onClick={() => void onContainerAction(containerName, action)}
                      >
                        {busyKey === `${containerName}:${action}` ? `${action}...` : action}
                      </Button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </DataTable>
      </DataCard>

      <DataCard title="Create Container" subtitle="Manual run config; no automation">
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs text-textMuted">Image</label>
              <input
                value={createImage}
                onChange={(event) => setCreateImage(event.target.value)}
                placeholder="e.g. nginx:latest"
                className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-textMuted">Container Name (optional)</label>
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="my-nginx"
                className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs text-textMuted">Restart Policy</label>
              <select
                value={createRestartPolicy}
                onChange={(event) =>
                  setCreateRestartPolicy(
                    event.target.value as 'no' | 'always' | 'unless-stopped' | 'on-failure'
                  )
                }
                className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
              >
                <option value="unless-stopped">unless-stopped</option>
                <option value="always">always</option>
                <option value="on-failure">on-failure</option>
                <option value="no">no</option>
              </select>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary">
              <input
                type="checkbox"
                checked={createAutoStart}
                onChange={(event) => setCreateAutoStart(event.target.checked)}
              />
              Auto start
            </label>
            <label className="flex items-center gap-2 rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary">
              <input
                type="checkbox"
                checked={createManaged}
                onChange={(event) => setCreateManaged(event.target.checked)}
              />
              Mark managed
            </label>
            <div className="flex items-end">
              <Button variant="primary" size="sm" disabled={Boolean(busyKey)} onClick={onCreate}>
                {busyKey === 'create' ? 'Creating...' : 'Create Container'}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-textMuted">Ports (one per line)</label>
              <textarea
                value={createPorts}
                onChange={(event) => setCreatePorts(event.target.value)}
                className="h-28 w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 font-mono text-xs text-textPrimary"
                placeholder={'8080\n3000:8080\n8123:8123/udp'}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-textMuted">Env (KEY=VALUE per line)</label>
              <textarea
                value={createEnv}
                onChange={(event) => setCreateEnv(event.target.value)}
                className="h-28 w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 font-mono text-xs text-textPrimary"
                placeholder={'NODE_ENV=production\nTZ=UTC'}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-textMuted">Binds (one per line)</label>
              <textarea
                value={createBinds}
                onChange={(event) => setCreateBinds(event.target.value)}
                className="h-28 w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 font-mono text-xs text-textPrimary"
                placeholder={'/host/path:/container/path\nnamed-volume:/data'}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-textMuted">Command (optional)</label>
            <input
              value={createCmd}
              onChange={(event) => setCreateCmd(event.target.value)}
              placeholder="node index.js"
              className="w-full rounded-md border border-borderSubtle bg-bgSurface px-3 py-2 text-sm text-textPrimary"
            />
          </div>
        </div>
      </DataCard>

      <DataCard title="Inspect & Logs" subtitle={selectedContainer ? selectedContainer : 'Select a container'}>
        {!selectedContainer ? (
          <p className="text-sm text-textMuted">Use "Inspect" on a container row to open details and logs.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-md border border-borderSubtle bg-bgSurface px-2 py-1 text-xs text-textMuted">
                {selectedContainer}
              </div>
              <label className="text-xs text-textMuted">Tail</label>
              <input
                type="number"
                min={1}
                max={5000}
                value={logTail}
                onChange={(event) => setLogTail(Math.min(Math.max(Number(event.target.value || 200), 1), 5000))}
                className="w-24 rounded-md border border-borderSubtle bg-bgSurface px-2 py-1 text-xs text-textPrimary"
              />
              <Button variant="secondary" size="xs" disabled={Boolean(busyKey)} onClick={() => void refreshLogs()}>
                {busyKey === `logs:${selectedContainer}` ? 'Loading...' : 'Refresh Logs'}
              </Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <textarea
                readOnly
                value={JSON.stringify(inspectData || {}, null, 2)}
                className="h-80 w-full rounded-md border border-borderSubtle bg-[#111111] px-3 py-2 font-mono text-xs text-textPrimary"
              />
              <textarea
                readOnly
                value={logs}
                className="h-80 w-full rounded-md border border-borderSubtle bg-[#111111] px-3 py-2 font-mono text-xs text-textPrimary"
              />
            </div>
          </div>
        )}
      </DataCard>
    </ContainerManagerLayout>
  );
}
