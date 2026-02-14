import { useEffect, useMemo, useState } from 'react';
import ContainerManagerLayout from '@/components/containers/ContainerManagerLayout';
import { DataCard } from '@/components/ui/DataCard';
import { Button } from '@/components/ui/Button';
import { fetchRuntime, runServiceAction, type RuntimePayload } from '@/lib/client/containers-admin';
import { useAdminGuard } from '@/lib/client/use-admin-guard';

const SERVICE_KEY = 'monitoring';
const SERVICE_ACTIONS: Array<'create' | 'start' | 'stop' | 'restart' | 'remove'> = [
  'create',
  'start',
  'stop',
  'restart',
  'remove',
];

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

export default function MonitoringServicePage() {
  const { token, ready, user, isAdmin, loading: authLoading, error: authError } = useAdminGuard('ide.containers.manage');
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async (options?: { silent?: boolean }) => {
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
      setError(err.message || 'Failed to load monitoring runtime');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !token || !user || !isAdmin) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, token, user?.id, isAdmin]);

  const serviceRow = useMemo(
    () => (runtime?.states || []).find((entry) => entry.service === SERVICE_KEY) || null,
    [runtime?.states]
  );

  const onAction = async (action: 'create' | 'start' | 'stop' | 'restart' | 'remove') => {
    if (!token) return;
    setBusyAction(action);
    setError('');
    setSuccess('');
    try {
      await runServiceAction(token, {
        service: SERVICE_KEY,
        action,
      });
      setSuccess(`Service ${SERVICE_KEY}: ${action} completed`);
      await load({ silent: true });
    } catch (err: any) {
      setError(err.message || `Failed to ${action} ${SERVICE_KEY}`);
    } finally {
      setBusyAction('');
    }
  };

  const stateText = getStateText(serviceRow?.state, Boolean(serviceRow?.error));

  return (
    <ContainerManagerLayout
      title="Monitoring Service"
      subtitle="Global container lifecycle for monitoring ingest."
      onRefresh={() => void load()}
      actions={
        <div className="flex items-center gap-2">
          <Button href="/admin/containers/services" variant="secondary" size="sm">
            Service Hub
          </Button>
          <Button href="/admin/containers/services/codex-gateway" variant="secondary" size="sm">
            Codex Gateway
          </Button>
        </div>
      }
    >
      {authLoading || loading ? <DataCard title="Loading monitoring service" subtitle="Please wait..." /> : null}

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

      {runtime?.configured === false ? (
        <DataCard
          title="Container manager not configured"
          subtitle="Set AGENT_CONTAINER_MANAGER_URL and AGENT_CONTAINER_MANAGER_TOKEN in IDE env."
        />
      ) : null}

      {runtime?.configured !== false ? (
        <DataCard title="Runtime State" subtitle="Container status and manual lifecycle actions">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-borderSubtle bg-bgApp p-3 text-sm">
              <div className="text-textMuted">service: {SERVICE_KEY}</div>
              <div className="text-textMuted">container: {serviceRow?.state?.containerName || '-'}</div>
              <div className="text-textMuted">engine: {serviceRow?.state?.engine || '-'}</div>
              <div className="text-textMuted">image: {serviceRow?.state?.image || '-'}</div>
              <div className="text-textMuted">port: {serviceRow?.state?.port ?? '-'}</div>
              {serviceRow?.state?.baseUrl ? (
                <a
                  href={serviceRow.state.baseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-accent hover:underline"
                >
                  {serviceRow.state.baseUrl}
                </a>
              ) : null}
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${getStateClass(stateText)}`}
              >
                {stateText}
              </span>
              {serviceRow?.error ? (
                <div className="text-xs text-danger break-words">{serviceRow.error}</div>
              ) : null}
            </div>
            <div className="flex flex-wrap content-start gap-1.5">
              {SERVICE_ACTIONS.map((action) => (
                <Button
                  key={action}
                  variant="secondary"
                  size="sm"
                  disabled={Boolean(busyAction)}
                  onClick={() => void onAction(action)}
                >
                  {busyAction === action ? `${action}...` : action}
                </Button>
              ))}
            </div>
          </div>
        </DataCard>
      ) : null}
    </ContainerManagerLayout>
  );
}
