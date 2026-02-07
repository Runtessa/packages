import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { PageHeader } from '@/components/layout/PageHeader';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import { useSessionToken } from '@/lib/client/session';
import { fetchJson } from '@/lib/client/api';
import {
  MONITORING_METRIC_OPTIONS,
  MONITORING_OPERATOR_OPTIONS,
  MONITORING_SCOPE_OPTIONS,
  MONITORING_SEVERITY_OPTIONS,
  metricLabel,
} from '@/lib/monitoring';

type Snapshot = {
  serverName: string;
  instanceId: string;
  instanceName: string;
  cpuPercent: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  storageUsedPct: number;
  threadActiveHandles: number;
  threadActiveRequests: number;
  networkInBytes: number;
  networkOutBytes: number;
  errorRatePct: number;
  createdAt: string;
};

type TenantSummary = {
  tenantId: string | null;
  tenantHostname: string | null;
  requestCount: number;
  errorCount: number;
  errorRatePct: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  networkInBytes: number;
  networkOutBytes: number;
};

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'global' | 'instance' | 'tenant';
  tenantId: string | null;
  metricKey: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  cooldownSec: number;
  severity: 'info' | 'warning' | 'critical';
  webhookUrl: string | null;
  webhookMethod: string;
  webhookHeaders: Record<string, string> | null;
  updatedAt: string;
};

type AlertEvent = {
  id: string;
  tenantId?: string | null;
  tenantHostname?: string | null;
  serverName: string;
  instanceId: string;
  instanceName: string;
  metricKey: string;
  metricValue: number;
  threshold: number;
  operator: string;
  severity: string;
  status: string;
  webhookStatus?: string | null;
  createdAt: string;
};

type SummaryResponse = {
  points: Array<{
    createdAt: string;
    cpuPercent: number;
    memoryRssMb: number;
    memoryHeapUsedMb: number;
    networkInBytes: number;
    networkOutBytes: number;
    threadActiveHandles: number;
    threadActiveRequests: number;
    storageUsedPct: number;
    errorRatePct: number;
  }>;
  latestSnapshot: Snapshot | null;
  servers: Array<{
    serverName: string;
    instanceCount: number;
    latestAt: string;
    avgCpuPercent: number;
    avgMemoryRssMb: number;
    avgStorageUsedPct: number;
    avgErrorRatePct: number;
  }>;
  instances: Snapshot[];
  tenants: TenantSummary[];
  instanceSeries?: Array<{
    key: string;
    serverName: string;
    instanceId: string;
    instanceName: string;
    points: Array<{
      createdAt: string;
      cpuPercent: number;
      memoryRssMb: number;
      memoryHeapUsedMb: number;
      networkInBytes: number;
      networkOutBytes: number;
      threadActiveHandles: number;
      threadActiveRequests: number;
      storageUsedPct: number;
      errorRatePct: number;
    }>;
  }>;
  tenantSeries?: Array<{
    key: string;
    tenantId: string | null;
    tenantHostname: string | null;
    points: Array<{
      createdAt: string;
      requestCount: number;
      errorCount: number;
      errorRatePct: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      maxLatencyMs: number;
      networkInBytes: number;
      networkOutBytes: number;
    }>;
  }>;
  alerts: {
    totalInWindow: number;
    enabledRuleCount: number;
    recent: AlertEvent[];
  };
};

type ChartDataset = {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor?: string;
  yAxisID?: string;
};

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

type RuleForm = {
  id?: string;
  name: string;
  enabled: boolean;
  scope: 'global' | 'instance' | 'tenant';
  tenantId: string;
  metricKey: string;
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: string;
  cooldownSec: string;
  severity: 'info' | 'warning' | 'critical';
  webhookUrl: string;
  webhookMethod: string;
  webhookHeaders: string;
};

const defaultRuleForm: RuleForm = {
  name: '',
  enabled: true,
  scope: 'global',
  tenantId: '',
  metricKey: 'cpu_percent',
  operator: 'gte',
  threshold: '90',
  cooldownSec: '300',
  severity: 'warning',
  webhookUrl: '',
  webhookMethod: 'POST',
  webhookHeaders: '',
};

const fmtNum = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : '0';

const fmtDate = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

const fmtBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[idx]}`;
};

const severityTone = (severity: string) => {
  if (severity === 'critical') return 'text-danger';
  if (severity === 'warning') return 'text-warning';
  return 'text-accent';
};

const TimelineChart = ({
  title,
  subtitle,
  labels,
  datasets,
}: {
  title: string;
  subtitle: string;
  labels: string[];
  datasets: ChartDataset[];
}) => {
  const chartData = useMemo(
    () => ({
      labels,
      datasets: datasets.map((item) => ({
        label: item.label,
        data: item.data,
        borderColor: item.borderColor,
        backgroundColor: item.backgroundColor || item.borderColor,
        pointRadius: 1.5,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.25,
        fill: false,
        yAxisID: item.yAxisID || 'y',
      })),
    }),
    [labels, datasets]
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: '#a3a3a3',
          },
        },
        tooltip: {
          enabled: true,
        },
      },
      scales: {
        x: {
          ticks: { color: '#a3a3a3', maxTicksLimit: 10 },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          ticks: { color: '#a3a3a3' },
          grid: { color: 'rgba(255,255,255,0.08)' },
        },
        y2: {
          position: 'right' as const,
          ticks: { color: '#a3a3a3' },
          grid: { drawOnChartArea: false },
        },
      },
    }),
    []
  );

  return (
    <DataCard title={title} subtitle={subtitle}>
      {!labels.length ? (
        <div className="rounded-md border border-borderSubtle bg-bgApp px-4 py-8 text-center text-sm text-textMuted">
          No timeline data in selected window
        </div>
      ) : (
        <div className="h-64 rounded-md border border-borderSubtle bg-bgApp/60 p-3">
          <Line data={chartData} options={chartOptions} />
        </div>
      )}
    </DataCard>
  );
};

export default function MonitoringDashboardPage() {
  const { token, ready } = useSessionToken();
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<RuleForm>(defaultRuleForm);
  const [selectedInstanceKey, setSelectedInstanceKey] = useState('');
  const [selectedTenantKey, setSelectedTenantKey] = useState('');

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setLoadingSummary(true);
    setError('');
    try {
      const data = (await fetchJson(`/api/admin/monitoring/summary?minutes=${windowMinutes}`, {
        token,
      })) as SummaryResponse;
      setSummary(data);
      setEvents(data.alerts?.recent || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load monitoring summary');
    } finally {
      setLoadingSummary(false);
    }
  }, [token, windowMinutes]);

  const loadRules = useCallback(async () => {
    if (!token) return;
    setLoadingRules(true);
    setError('');
    try {
      const data = await fetchJson('/api/admin/monitoring/rules', { token });
      setRules(data.rules || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load alert rules');
    } finally {
      setLoadingRules(false);
    }
  }, [token]);

  const loadEvents = useCallback(async () => {
    if (!token) return;
    setLoadingEvents(true);
    setError('');
    try {
      const data = await fetchJson(`/api/admin/monitoring/events?minutes=${windowMinutes}&limit=50`, {
        token,
      });
      setEvents(data.events || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load alert events');
    } finally {
      setLoadingEvents(false);
    }
  }, [token, windowMinutes]);

  useEffect(() => {
    if (!ready || !token) return;
    void Promise.all([loadSummary(), loadRules(), loadEvents()]);
  }, [ready, token, loadSummary, loadRules, loadEvents]);

  useEffect(() => {
    if (!ready || !token) return;
    const timer = setInterval(() => {
      void Promise.all([loadSummary(), loadEvents()]);
    }, 4000);
    return () => clearInterval(timer);
  }, [ready, token, loadSummary, loadEvents]);

  const tenantOptions = useMemo(
    () =>
      (summary?.tenants || [])
        .filter((item) => item.tenantId)
        .map((item) => ({
          label: item.tenantHostname || item.tenantId || 'Tenant',
          value: item.tenantId as string,
        })),
    [summary?.tenants]
  );

  const timelinePoints = useMemo(
    () =>
      (summary?.points || []).slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [summary?.points]
  );

  const globalChartLabels = useMemo(
    () => timelinePoints.map((point) => new Date(point.createdAt).toLocaleTimeString()),
    [timelinePoints]
  );

  const instanceSeries = summary?.instanceSeries || [];
  const tenantSeries = summary?.tenantSeries || [];

  useEffect(() => {
    if (!instanceSeries.length) {
      setSelectedInstanceKey('');
      return;
    }
    if (!selectedInstanceKey || !instanceSeries.some((series) => series.key === selectedInstanceKey)) {
      setSelectedInstanceKey(instanceSeries[0].key);
    }
  }, [instanceSeries, selectedInstanceKey]);

  useEffect(() => {
    if (!tenantSeries.length) {
      setSelectedTenantKey('');
      return;
    }
    if (!selectedTenantKey || !tenantSeries.some((series) => series.key === selectedTenantKey)) {
      setSelectedTenantKey(tenantSeries[0].key);
    }
  }, [tenantSeries, selectedTenantKey]);

  const selectedInstanceSeries = useMemo(
    () => instanceSeries.find((series) => series.key === selectedInstanceKey) || null,
    [instanceSeries, selectedInstanceKey]
  );

  const selectedTenantSeries = useMemo(
    () => tenantSeries.find((series) => series.key === selectedTenantKey) || null,
    [tenantSeries, selectedTenantKey]
  );

  const instanceChartLabels = useMemo(
    () =>
      (selectedInstanceSeries?.points || []).map((point) =>
        new Date(point.createdAt).toLocaleTimeString()
      ),
    [selectedInstanceSeries]
  );

  const tenantChartLabels = useMemo(
    () =>
      (selectedTenantSeries?.points || []).map((point) =>
        new Date(point.createdAt).toLocaleTimeString()
      ),
    [selectedTenantSeries]
  );

  const submitRule = async () => {
    if (!token) return;
    setError('');
    setSuccess('');

    try {
      const payload = {
        name: form.name,
        enabled: form.enabled,
        scope: form.scope,
        tenantId: form.scope === 'tenant' ? form.tenantId : null,
        metricKey: form.metricKey,
        operator: form.operator,
        threshold: Number(form.threshold),
        cooldownSec: Number(form.cooldownSec),
        severity: form.severity,
        webhookUrl: form.webhookUrl || null,
        webhookMethod: form.webhookMethod || 'POST',
        webhookHeaders: form.webhookHeaders || null,
      };

      if (form.id) {
        await fetchJson(`/api/admin/monitoring/rules/${form.id}`, {
          token,
          method: 'PUT',
          body: payload,
        });
        setSuccess('Alert rule updated');
      } else {
        await fetchJson('/api/admin/monitoring/rules', {
          token,
          method: 'POST',
          body: payload,
        });
        setSuccess('Alert rule created');
      }

      setForm(defaultRuleForm);
      await loadRules();
      await loadSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to save rule');
    }
  };

  const editRule = (rule: Rule) => {
    setForm({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      scope: rule.scope,
      tenantId: rule.tenantId || '',
      metricKey: rule.metricKey as RuleForm['metricKey'],
      operator: rule.operator,
      threshold: String(rule.threshold),
      cooldownSec: String(rule.cooldownSec),
      severity: rule.severity,
      webhookUrl: rule.webhookUrl || '',
      webhookMethod: rule.webhookMethod || 'POST',
      webhookHeaders: rule.webhookHeaders ? JSON.stringify(rule.webhookHeaders, null, 2) : '',
    });
  };

  const removeRule = async (ruleId: string) => {
    if (!token) return;
    setError('');
    setSuccess('');
    try {
      await fetchJson(`/api/admin/monitoring/rules/${ruleId}`, {
        token,
        method: 'DELETE',
      });
      setSuccess('Rule deleted');
      if (form.id === ruleId) setForm(defaultRuleForm);
      await loadRules();
      await loadSummary();
    } catch (err: any) {
      setError(err.message || 'Failed to delete rule');
    }
  };

  const latest = summary?.latestSnapshot;

  return (
    <div className="page-container space-y-6 py-10">
      <PageHeader
        title="Monitoring"
        subtitle="Live non-blocking metrics and alerting for servers, instances, and tenants."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={String(windowMinutes)}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
              options={[
                { label: '15 min', value: '15' },
                { label: '60 min', value: '60' },
                { label: '6 hours', value: '360' },
                { label: '24 hours', value: '1440' },
              ]}
            />
            <Button variant="secondary" onClick={() => void Promise.all([loadSummary(), loadRules(), loadEvents()])}>
              Refresh
            </Button>
          </div>
        }
      />

      {error && <div className="rounded-lg border border-danger bg-bgApp px-4 py-3 text-sm text-danger">{error}</div>}
      {success && (
        <div className="rounded-lg border border-accent bg-bgApp px-4 py-3 text-sm text-accent">{success}</div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <DataCard title="CPU" subtitle="Latest snapshot" className="p-4">
          <div className="text-2xl font-semibold text-textPrimary">{latest ? `${fmtNum(latest.cpuPercent)}%` : '-'}</div>
        </DataCard>
        <DataCard title="Memory RSS" subtitle="Latest snapshot" className="p-4">
          <div className="text-2xl font-semibold text-textPrimary">{latest ? `${fmtNum(latest.memoryRssMb)} MB` : '-'}</div>
        </DataCard>
        <DataCard title="Storage" subtitle="Latest snapshot" className="p-4">
          <div className="text-2xl font-semibold text-textPrimary">{latest ? `${fmtNum(latest.storageUsedPct)}%` : '-'}</div>
        </DataCard>
        <DataCard title="Threads" subtitle="Handles / requests" className="p-4">
          <div className="text-2xl font-semibold text-textPrimary">
            {latest ? `${latest.threadActiveHandles} / ${latest.threadActiveRequests}` : '-'}
          </div>
        </DataCard>
        <DataCard title="Alerts" subtitle="In current window" className="p-4">
          <div className="text-2xl font-semibold text-textPrimary">{summary?.alerts?.totalInWindow ?? 0}</div>
        </DataCard>
      </div>

      <DataCard title="Global Scope Charts" subtitle="Interactive system-wide trends">
        <div className="grid gap-4 xl:grid-cols-2">
          <TimelineChart
            title="Load & Reliability"
            subtitle="CPU and error-rate over time"
            labels={globalChartLabels}
            datasets={[
              {
                label: 'CPU %',
                data: timelinePoints.map((point) => Number(point.cpuPercent) || 0),
                borderColor: '#22d3ee',
              },
              {
                label: 'Error Rate %',
                data: timelinePoints.map((point) => Number(point.errorRatePct) || 0),
                borderColor: '#f59e0b',
                yAxisID: 'y2',
              },
            ]}
          />
          <TimelineChart
            title="Memory"
            subtitle="RSS and heap usage"
            labels={globalChartLabels}
            datasets={[
              {
                label: 'RSS MB',
                data: timelinePoints.map((point) => Number(point.memoryRssMb) || 0),
                borderColor: '#34d399',
              },
              {
                label: 'Heap Used MB',
                data: timelinePoints.map((point) => Number(point.memoryHeapUsedMb) || 0),
                borderColor: '#a78bfa',
              },
            ]}
          />
          <TimelineChart
            title="Network"
            subtitle="Inbound / outbound traffic"
            labels={globalChartLabels}
            datasets={[
              {
                label: 'Network In',
                data: timelinePoints.map((point) => Number(point.networkInBytes) || 0),
                borderColor: '#60a5fa',
              },
              {
                label: 'Network Out',
                data: timelinePoints.map((point) => Number(point.networkOutBytes) || 0),
                borderColor: '#f472b6',
              },
            ]}
          />
          <TimelineChart
            title="Threads & Storage"
            subtitle="Runtime pressure indicators"
            labels={globalChartLabels}
            datasets={[
              {
                label: 'Active Handles',
                data: timelinePoints.map((point) => Number(point.threadActiveHandles) || 0),
                borderColor: '#f97316',
              },
              {
                label: 'Active Requests',
                data: timelinePoints.map((point) => Number(point.threadActiveRequests) || 0),
                borderColor: '#fde047',
              },
              {
                label: 'Storage %',
                data: timelinePoints.map((point) => Number(point.storageUsedPct) || 0),
                borderColor: '#10b981',
                yAxisID: 'y2',
              },
            ]}
          />
        </div>
      </DataCard>

      <DataCard
        title="Instance Scope Charts"
        subtitle="Choose an instance to inspect full metrics timeline"
        actions={
          <Select
            value={selectedInstanceKey}
            onChange={(e) => setSelectedInstanceKey(e.target.value)}
            options={(instanceSeries || []).map((series) => ({
              label: `${series.serverName} / ${series.instanceName || series.instanceId}`,
              value: series.key,
            }))}
          />
        }
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <TimelineChart
            title="Instance CPU/Errors"
            subtitle="Per-instance load and reliability"
            labels={instanceChartLabels}
            datasets={[
              {
                label: 'CPU %',
                data: (selectedInstanceSeries?.points || []).map((point) => Number(point.cpuPercent) || 0),
                borderColor: '#38bdf8',
              },
              {
                label: 'Error Rate %',
                data: (selectedInstanceSeries?.points || []).map((point) => Number(point.errorRatePct) || 0),
                borderColor: '#fb923c',
                yAxisID: 'y2',
              },
            ]}
          />
          <TimelineChart
            title="Instance Memory/Network"
            subtitle="Per-instance memory and traffic"
            labels={instanceChartLabels}
            datasets={[
              {
                label: 'RSS MB',
                data: (selectedInstanceSeries?.points || []).map((point) => Number(point.memoryRssMb) || 0),
                borderColor: '#22c55e',
              },
              {
                label: 'Network In',
                data: (selectedInstanceSeries?.points || []).map((point) => Number(point.networkInBytes) || 0),
                borderColor: '#a855f7',
                yAxisID: 'y2',
              },
            ]}
          />
        </div>
      </DataCard>

      <DataCard
        title="Tenant Scope Charts"
        subtitle="Choose a tenant to inspect request/error/latency/network trends"
        actions={
          <Select
            value={selectedTenantKey}
            onChange={(e) => setSelectedTenantKey(e.target.value)}
            options={(tenantSeries || []).map((series) => ({
              label: series.tenantHostname || series.tenantId || 'Tenant',
              value: series.key,
            }))}
          />
        }
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <TimelineChart
            title="Tenant Requests/Errors"
            subtitle="Traffic and reliability"
            labels={tenantChartLabels}
            datasets={[
              {
                label: 'Requests',
                data: (selectedTenantSeries?.points || []).map((point) => Number(point.requestCount) || 0),
                borderColor: '#0ea5e9',
              },
              {
                label: 'Error Rate %',
                data: (selectedTenantSeries?.points || []).map((point) => Number(point.errorRatePct) || 0),
                borderColor: '#f97316',
                yAxisID: 'y2',
              },
            ]}
          />
          <TimelineChart
            title="Tenant Latency/Network"
            subtitle="Performance and throughput"
            labels={tenantChartLabels}
            datasets={[
              {
                label: 'Avg Latency (ms)',
                data: (selectedTenantSeries?.points || []).map((point) => Number(point.avgLatencyMs) || 0),
                borderColor: '#84cc16',
              },
              {
                label: 'Network Out',
                data: (selectedTenantSeries?.points || []).map((point) => Number(point.networkOutBytes) || 0),
                borderColor: '#ec4899',
                yAxisID: 'y2',
              },
            ]}
          />
        </div>
      </DataCard>

      <DataCard title="Servers" subtitle="Aggregated by server across active instances.">
        <DataTable headers={['Server', 'Instances', 'CPU %', 'Memory MB', 'Storage %', 'Error %', 'Latest']} loading={loadingSummary}>
          {(summary?.servers || []).map((server) => (
            <tr key={server.serverName} className="hover:bg-bgApp transition">
              <td className="px-4 py-3 text-textPrimary">{server.serverName}</td>
              <td className="px-4 py-3 text-textMuted">{server.instanceCount}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(server.avgCpuPercent)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(server.avgMemoryRssMb)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(server.avgStorageUsedPct)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(server.avgErrorRatePct)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtDate(server.latestAt)}</td>
            </tr>
          ))}
        </DataTable>
      </DataCard>

      <DataCard title="Instances" subtitle="Per-instance metrics.">
        <DataTable
          headers={['Server', 'Instance', 'CPU %', 'Memory MB', 'Network In', 'Network Out', 'Threads', 'Updated']}
          loading={loadingSummary}
        >
          {(summary?.instances || []).map((instance) => (
            <tr key={`${instance.serverName}:${instance.instanceId}`} className="hover:bg-bgApp transition">
              <td className="px-4 py-3 text-textPrimary">{instance.serverName}</td>
              <td className="px-4 py-3 text-textMuted">{instance.instanceName || instance.instanceId}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(instance.cpuPercent)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(instance.memoryRssMb)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtBytes(instance.networkInBytes)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtBytes(instance.networkOutBytes)}</td>
              <td className="px-4 py-3 text-textMuted">
                {instance.threadActiveHandles}/{instance.threadActiveRequests}
              </td>
              <td className="px-4 py-3 text-textMuted">{fmtDate(instance.createdAt)}</td>
            </tr>
          ))}
        </DataTable>
      </DataCard>

      <DataCard title="Tenants" subtitle="Aggregated request/error/latency per tenant in selected window.">
        <DataTable
          headers={['Tenant', 'Requests', 'Errors', 'Error %', 'Avg Latency', 'P95', 'Network In', 'Network Out']}
          loading={loadingSummary}
        >
          {(summary?.tenants || []).map((tenant) => (
            <tr key={`${tenant.tenantId || 'unknown'}:${tenant.tenantHostname || ''}`} className="hover:bg-bgApp transition">
              <td className="px-4 py-3 text-textPrimary">{tenant.tenantHostname || tenant.tenantId || '-'}</td>
              <td className="px-4 py-3 text-textMuted">{tenant.requestCount}</td>
              <td className="px-4 py-3 text-textMuted">{tenant.errorCount}</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(tenant.errorRatePct)}%</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(tenant.avgLatencyMs)} ms</td>
              <td className="px-4 py-3 text-textMuted">{fmtNum(tenant.p95LatencyMs)} ms</td>
              <td className="px-4 py-3 text-textMuted">{fmtBytes(tenant.networkInBytes)}</td>
              <td className="px-4 py-3 text-textMuted">{fmtBytes(tenant.networkOutBytes)}</td>
            </tr>
          ))}
        </DataTable>
      </DataCard>

      <DataCard title="Alert Rules" subtitle="Define thresholds and optional webhooks. Rules execute asynchronously.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Input
            label="Rule Name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="High CPU"
          />
          <Select
            label="Scope"
            value={form.scope}
            onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value as RuleForm['scope'] }))}
            options={MONITORING_SCOPE_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          />
          <Select
            label="Metric"
            value={form.metricKey}
            onChange={(e) => setForm((prev) => ({ ...prev, metricKey: e.target.value }))}
            options={MONITORING_METRIC_OPTIONS.filter((item) => form.scope === 'tenant' || item.scope !== 'tenant').map(
              (item) => ({ label: item.label, value: item.value })
            )}
          />
          <Select
            label="Operator"
            value={form.operator}
            onChange={(e) => setForm((prev) => ({ ...prev, operator: e.target.value as RuleForm['operator'] }))}
            options={MONITORING_OPERATOR_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          />
          <Input
            label="Threshold"
            value={form.threshold}
            onChange={(e) => setForm((prev) => ({ ...prev, threshold: e.target.value }))}
            placeholder="90"
          />
          <Input
            label="Cooldown (sec)"
            value={form.cooldownSec}
            onChange={(e) => setForm((prev) => ({ ...prev, cooldownSec: e.target.value }))}
            placeholder="300"
          />
          <Select
            label="Severity"
            value={form.severity}
            onChange={(e) => setForm((prev) => ({ ...prev, severity: e.target.value as RuleForm['severity'] }))}
            options={MONITORING_SEVERITY_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
          />
          {form.scope === 'tenant' && (
            <Select
              label="Tenant"
              value={form.tenantId}
              onChange={(e) => setForm((prev) => ({ ...prev, tenantId: e.target.value }))}
              options={[{ label: 'Select tenant', value: '' }, ...tenantOptions]}
            />
          )}
          <Input
            label="Webhook URL"
            value={form.webhookUrl}
            onChange={(e) => setForm((prev) => ({ ...prev, webhookUrl: e.target.value }))}
            placeholder="https://example.com/hook"
          />
          <Input
            label="Webhook Method"
            value={form.webhookMethod}
            onChange={(e) => setForm((prev) => ({ ...prev, webhookMethod: e.target.value }))}
            placeholder="POST"
          />
        </div>
        <div className="mt-3">
          <TextArea
            label="Webhook Headers (JSON)"
            value={form.webhookHeaders}
            onChange={(e) => setForm((prev) => ({ ...prev, webhookHeaders: e.target.value }))}
            placeholder='{"Authorization":"Bearer ..."}'
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-textMuted">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            Enabled
          </label>
          <Button onClick={() => void submitRule()}>{form.id ? 'Update Rule' : 'Create Rule'}</Button>
          <Button variant="secondary" onClick={() => setForm(defaultRuleForm)}>
            Reset
          </Button>
        </div>

        <div className="mt-4">
          <DataTable
            headers={['Name', 'Scope', 'Metric', 'Condition', 'Severity', 'Webhook', 'Updated', 'Actions']}
            loading={loadingRules}
            emptyMessage="No alert rules configured"
          >
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-bgApp transition">
                <td className="px-4 py-3 text-textPrimary">
                  {rule.name}
                  {!rule.enabled && <span className="ml-2 text-xs text-textMuted">(disabled)</span>}
                </td>
                <td className="px-4 py-3 text-textMuted">{rule.scope}</td>
                <td className="px-4 py-3 text-textMuted">{metricLabel(rule.metricKey)}</td>
                <td className="px-4 py-3 text-textMuted">
                  {rule.operator} {rule.threshold}
                </td>
                <td className={`px-4 py-3 ${severityTone(rule.severity)}`}>{rule.severity}</td>
                <td className="px-4 py-3 text-textMuted">{rule.webhookUrl ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 text-textMuted">{fmtDate(rule.updatedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => editRule(rule)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void removeRule(rule.id)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </DataCard>

      <DataCard title="Alert Events" subtitle="Recent triggered events and webhook delivery status.">
        <DataTable
          headers={['Time', 'Severity', 'Metric', 'Value', 'Target', 'Server/Instance', 'Webhook']}
          loading={loadingEvents}
          emptyMessage="No alert events in selected window"
        >
          {events.map((event) => (
            <tr key={event.id} className="hover:bg-bgApp transition">
              <td className="px-4 py-3 text-textMuted">{fmtDate(event.createdAt)}</td>
              <td className={`px-4 py-3 ${severityTone(event.severity)}`}>{event.severity}</td>
              <td className="px-4 py-3 text-textMuted">{metricLabel(event.metricKey)}</td>
              <td className="px-4 py-3 text-textMuted">
                {fmtNum(event.metricValue)} ({event.operator} {fmtNum(event.threshold)})
              </td>
              <td className="px-4 py-3 text-textMuted">{event.tenantHostname || event.tenantId || '-'}</td>
              <td className="px-4 py-3 text-textMuted">
                {event.serverName} / {event.instanceName || event.instanceId}
              </td>
              <td className="px-4 py-3 text-textMuted">{event.webhookStatus || '-'}</td>
            </tr>
          ))}
        </DataTable>
      </DataCard>
    </div>
  );
}
