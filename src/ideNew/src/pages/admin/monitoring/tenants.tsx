import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import MonitoringLayout from '@/components/monitoring/MonitoringLayout';
import TimelineChart from '@/components/monitoring/TimelineChart';
import { fmtBytes, fmtNum } from '@/components/monitoring/format';
import { useMonitoringData } from '@/components/monitoring/useMonitoringData';

export default function MonitoringTenantsPage() {
  const {
    windowMinutes,
    setWindowMinutes,
    refreshAll,
    error,
    summary,
    loadingSummary,
    tenantSeries,
    selectedTenantKey,
    setSelectedTenantKey,
    selectedTenantSeries,
    tenantChartLabels,
  } = useMonitoringData();

  return (
    <MonitoringLayout
      title="Tenant Monitoring"
      subtitle="Per-tenant traffic, errors, and latency"
      windowMinutes={windowMinutes}
      onWindowChange={setWindowMinutes}
      onRefresh={() => void refreshAll()}
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        <DataCard
          title="Tenant Scope"
          subtitle="Per-tenant trends"
          className="border border-[#2a2d2e] bg-[#252526] p-3"
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
          <div className="grid gap-3 2xl:grid-cols-2">
            <TimelineChart
              title="Tenant: Requests/Errors"
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
              title="Tenant: Latency"
              subtitle="Average, P95, max latency"
              labels={tenantChartLabels}
              datasets={[
                {
                  label: 'Avg Latency (ms)',
                  data: (selectedTenantSeries?.points || []).map((point) => Number(point.avgLatencyMs) || 0),
                  borderColor: '#84cc16',
                },
                {
                  label: 'P95 Latency (ms)',
                  data: (selectedTenantSeries?.points || []).map((point) => Number(point.p95LatencyMs) || 0),
                  borderColor: '#a78bfa',
                },
                {
                  label: 'Max Latency (ms)',
                  data: (selectedTenantSeries?.points || []).map((point) => Number(point.maxLatencyMs) || 0),
                  borderColor: '#ef4444',
                },
              ]}
            />
            <TimelineChart
              title="Tenant: Network"
              subtitle="Inbound and outbound throughput"
              labels={tenantChartLabels}
              datasets={[
                {
                  label: 'Network In',
                  data: (selectedTenantSeries?.points || []).map((point) => Number(point.networkInBytes) || 0),
                  borderColor: '#22d3ee',
                },
                {
                  label: 'Network Out',
                  data: (selectedTenantSeries?.points || []).map((point) => Number(point.networkOutBytes) || 0),
                  borderColor: '#ec4899',
                },
              ]}
            />
          </div>
        </DataCard>

        <DataCard title="Tenant Table" subtitle="Current window summary" className="border border-[#2a2d2e] bg-[#252526] p-3">
          <DataTable headers={['Tenant', 'Requests', 'Errors', 'Error %', 'Avg', 'P95', 'Max', 'Net In', 'Net Out']} loading={loadingSummary}>
            {(summary?.tenants || []).map((tenant) => (
              <tr key={`${tenant.tenantId || 'unknown'}:${tenant.tenantHostname || ''}`} className="hover:bg-bgApp transition">
                <td className="px-3 py-2 text-textPrimary">{tenant.tenantHostname || tenant.tenantId || '-'}</td>
                <td className="px-3 py-2 text-textMuted">{tenant.requestCount}</td>
                <td className="px-3 py-2 text-textMuted">{tenant.errorCount}</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(tenant.errorRatePct)}%</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(tenant.avgLatencyMs)} ms</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(tenant.p95LatencyMs)} ms</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(tenant.maxLatencyMs)} ms</td>
                <td className="px-3 py-2 text-textMuted">{fmtBytes(tenant.networkInBytes)}</td>
                <td className="px-3 py-2 text-textMuted">{fmtBytes(tenant.networkOutBytes)}</td>
              </tr>
            ))}
          </DataTable>
        </DataCard>
      </div>
    </MonitoringLayout>
  );
}
