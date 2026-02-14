import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ContainerManagerLayout from '@/components/containers/ContainerManagerLayout';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { fetchRuntime, type RuntimePayload } from '@/lib/client/containers-admin';
import { useAdminGuard } from '@/lib/client/use-admin-guard';

const asName = (names?: string[]) => String(names?.[0] || '').replace(/^\/+/, '');

export default function ContainerOverviewPage() {
  const { token, ready, isAdmin, user, loading: authLoading, error: authError } = useAdminGuard('ide.containers.read');
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!token || !user) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchRuntime(token, {
        userId: String(user.id),
        userName: user.email,
      });
      setRuntime(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load runtime');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !token || !user || !isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, user?.id, isAdmin]);

  const counters = useMemo(() => {
    const states = Array.isArray(runtime?.states) ? runtime.states : [];
    const containers = Array.isArray(runtime?.containers) ? runtime.containers : [];
    const runningServices = states.filter((row) => row.state?.running).length;
    const stoppedServices = states.filter((row) => row.state && !row.state.running).length;
    const runningContainers = containers.filter((row) => String(row.state || '').toLowerCase() === 'running').length;
    return {
      services: states.length,
      runningServices,
      stoppedServices,
      containers: containers.length,
      runningContainers,
      stoppedContainers: Math.max(containers.length - runningContainers, 0),
    };
  }, [runtime]);

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
    <ContainerManagerLayout
      title="Container Orchestrator"
      subtitle="Manual control over container-manager runtime, services, and managed containers."
      onRefresh={() => void load()}
      actions={
        <div className="flex items-center gap-2">
          <Button href="/admin/containers/services" variant="secondary" size="sm">
            Open Services
          </Button>
          <Button href="/admin/containers/containers" variant="secondary" size="sm">
            Open Containers
          </Button>
        </div>
      }
    >
      {authLoading || loading ? (
        <DataCard title="Loading" subtitle="Fetching container manager runtime...">
          <p className="text-sm text-textMuted">Please wait.</p>
        </DataCard>
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

      {runtime && runtime.configured === false ? (
        <DataCard
          title="Container manager not configured"
          subtitle="Set AGENT_CONTAINER_MANAGER_URL and AGENT_CONTAINER_MANAGER_TOKEN in IDE env."
        >
          <p className="text-sm text-textMuted">
            This section depends on container-manager and does not access Docker/Podman sockets directly.
          </p>
        </DataCard>
      ) : null}

      {runtime && runtime.configured !== false ? (
        <>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-xs uppercase text-textMuted">Services</div>
              <div className="mt-1 text-xl font-semibold text-textPrimary">{counters.services}</div>
            </div>
            <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-xs uppercase text-textMuted">Services Up</div>
              <div className="mt-1 text-xl font-semibold text-accent">{counters.runningServices}</div>
            </div>
            <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-xs uppercase text-textMuted">Services Down</div>
              <div className="mt-1 text-xl font-semibold text-amber-300">{counters.stoppedServices}</div>
            </div>
            <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-xs uppercase text-textMuted">Containers</div>
              <div className="mt-1 text-xl font-semibold text-textPrimary">{counters.containers}</div>
            </div>
            <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-xs uppercase text-textMuted">Running</div>
              <div className="mt-1 text-xl font-semibold text-accent">{counters.runningContainers}</div>
            </div>
            <div className="rounded-lg border border-borderSubtle bg-bgSurface p-3">
              <div className="text-xs uppercase text-textMuted">Stopped</div>
              <div className="mt-1 text-xl font-semibold text-amber-300">{counters.stoppedContainers}</div>
            </div>
          </div>

          <DataCard title="Manager Runtime" subtitle="Control-plane health and version">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-borderSubtle bg-bgApp p-3">
                <div className="text-xs uppercase text-textMuted">Service</div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {runtime.managerVersion?.service || 'idp-container-manager'}
                </div>
              </div>
              <div className="rounded-lg border border-borderSubtle bg-bgApp p-3">
                <div className="text-xs uppercase text-textMuted">Version</div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {runtime.managerVersion?.version || '-'}
                </div>
              </div>
              <div className="rounded-lg border border-borderSubtle bg-bgApp p-3">
                <div className="text-xs uppercase text-textMuted">Started</div>
                <div className="mt-1 text-sm font-semibold text-textPrimary">
                  {runtime.managerVersion?.startedAt
                    ? new Date(runtime.managerVersion.startedAt).toLocaleString()
                    : '-'}
                </div>
              </div>
            </div>
          </DataCard>

          <DataCard title="Recent Containers" subtitle="Quick visibility over managed service containers">
            <DataTable headers={['Container', 'Service', 'Image', 'State', 'Ports']} loading={loading}>
              {(runtime.containers || []).slice(0, 12).map((row) => (
                <tr key={String(row.id)} className="hover:bg-bgApp transition">
                  <td className="px-4 py-3 text-textPrimary">
                    <div className="font-medium">{asName(row.names)}</div>
                    <div className="text-xs text-textMuted">{String(row.id || '').slice(0, 12)}</div>
                  </td>
                  <td className="px-4 py-3 text-textMuted">{String(row.labels?.['idp.service'] || '-')}</td>
                  <td className="px-4 py-3 text-textMuted">{String(row.image || '-')}</td>
                  <td className="px-4 py-3 text-textMuted">{String(row.status || row.state || '-')}</td>
                  <td className="px-4 py-3 text-xs text-textMuted">
                    {(row.ports || [])
                      .map((p) => {
                        const pub = Number((p as any).PublicPort);
                        const priv = Number((p as any).PrivatePort);
                        const typ = String((p as any).Type || 'tcp');
                        if (Number.isFinite(pub) && Number.isFinite(priv)) return `${pub}:${priv}/${typ}`;
                        return Number.isFinite(priv) ? `${priv}/${typ}` : '-';
                      })
                      .join(', ') || '-'}
                  </td>
                </tr>
              ))}
            </DataTable>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/admin/containers/services" className="text-sm text-accent hover:underline">
                Manage services
              </Link>
              <span className="text-textMuted">•</span>
              <Link href="/admin/containers/containers" className="text-sm text-accent hover:underline">
                Open full container controls
              </Link>
            </div>
          </DataCard>
        </>
      ) : null}
    </ContainerManagerLayout>
  );
}
