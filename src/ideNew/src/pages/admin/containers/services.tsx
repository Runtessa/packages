import { useEffect, useMemo, useState } from 'react';
import ContainerManagerLayout from '@/components/containers/ContainerManagerLayout';
import { DataCard } from '@/components/ui/DataCard';
import { Button } from '@/components/ui/Button';
import { fetchRuntime, type RuntimePayload } from '@/lib/client/containers-admin';
import { useAdminGuard } from '@/lib/client/use-admin-guard';

const getStateText = (state?: { running?: boolean; exists?: boolean } | null, hasError?: boolean) => {
  if (state?.running) return 'running';
  if (state?.exists) return 'stopped';
  if (hasError) return 'error';
  return 'not created';
};

const getStateClass = (stateText: string) => {
  if (stateText === 'running') return 'border-accent/60 bg-accent/10 text-textPrimary';
  if (stateText === 'stopped') return 'border-amber-500/40 text-amber-300';
  if (stateText === 'error') return 'border-danger/40 text-danger';
  return 'border-borderSubtle text-textMuted';
};

export default function ContainerServicesPage() {
  const { token, ready, user, isAdmin, loading: authLoading, error: authError } = useAdminGuard('ide.containers.manage');
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
      setError(err.message || 'Failed to load services runtime');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !token || !user || !isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, user?.id, isAdmin]);

  const codexState = useMemo(
    () => (runtime?.states || []).find((entry) => entry.service === 'codex-gateway') || null,
    [runtime?.states]
  );
  const monitoringState = useMemo(
    () => (runtime?.states || []).find((entry) => entry.service === 'monitoring') || null,
    [runtime?.states]
  );

  return (
    <ContainerManagerLayout
      title="Service Control"
      subtitle="Split service management by concern."
      onRefresh={() => void load()}
    >
      {authLoading || loading ? <DataCard title="Loading services" subtitle="Please wait..." /> : null}

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

      {runtime?.configured === false ? (
        <DataCard
          title="Container manager not configured"
          subtitle="Set AGENT_CONTAINER_MANAGER_URL and AGENT_CONTAINER_MANAGER_TOKEN in IDE env."
        />
      ) : null}

      {runtime?.configured !== false ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <DataCard
            title="Codex Gateway"
            subtitle="Per-user container lifecycle and status for codex-gateway."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-textMuted">
                <span>container: {codexState?.state?.containerName || '-'}</span>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 ${getStateClass(
                    getStateText(codexState?.state, Boolean(codexState?.error))
                  )}`}
                >
                  {getStateText(codexState?.state, Boolean(codexState?.error))}
                </span>
              </div>
              <p className="text-sm text-textMuted">
                Open dedicated controls to target user scope and run create/start/stop/restart/remove.
              </p>
              <Button href="/admin/containers/services/codex-gateway" variant="secondary" size="sm">
                Open Codex Gateway
              </Button>
            </div>
          </DataCard>

          <DataCard
            title="Monitoring"
            subtitle="Global monitoring service lifecycle and runtime status."
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-textMuted">
                <span>container: {monitoringState?.state?.containerName || '-'}</span>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 ${getStateClass(
                    getStateText(monitoringState?.state, Boolean(monitoringState?.error))
                  )}`}
                >
                  {getStateText(monitoringState?.state, Boolean(monitoringState?.error))}
                </span>
              </div>
              <p className="text-sm text-textMuted">
                Open dedicated controls to run lifecycle actions for the monitoring container.
              </p>
              <Button href="/admin/containers/services/monitoring" variant="secondary" size="sm">
                Open Monitoring
              </Button>
            </div>
          </DataCard>
        </div>
      ) : null}
    </ContainerManagerLayout>
  );
}
