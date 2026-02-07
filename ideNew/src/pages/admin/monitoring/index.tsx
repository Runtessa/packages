import Link from 'next/link';
import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { fmtNum } from '@/components/monitoring/format';
import MonitoringLayout from '@/components/monitoring/MonitoringLayout';
import TimelineChart from '@/components/monitoring/TimelineChart';
import { useMonitoringData } from '@/components/monitoring/useMonitoringData';

export default function MonitoringOverviewPage() {
  const {
    windowMinutes,
    setWindowMinutes,
    refreshAll,
    error,
    success,
    summary,
    loadingSummary,
    timelinePoints,
    globalChartLabels,
  } = useMonitoringData();

  const latest = summary?.latestSnapshot;

  return (
    <MonitoringLayout
      title="Core Monitoring"
      subtitle="Global system telemetry"
      windowMinutes={windowMinutes}
      onWindowChange={setWindowMinutes}
      onRefresh={() => void refreshAll()}
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}
        {success && (
          <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">{success}</div>
        )}

        <div className="grid gap-3 lg:grid-cols-5">
          <div className="rounded-md border border-[#2a2d2e] bg-[#252526] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-textMuted">CPU</div>
            <div className="mt-1 text-xl font-semibold">{latest ? `${fmtNum(latest.cpuPercent)}%` : '-'}</div>
          </div>
          <div className="rounded-md border border-[#2a2d2e] bg-[#252526] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-textMuted">Memory RSS</div>
            <div className="mt-1 text-xl font-semibold">{latest ? `${fmtNum(latest.memoryRssMb)} MB` : '-'}</div>
          </div>
          <div className="rounded-md border border-[#2a2d2e] bg-[#252526] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-textMuted">Storage</div>
            <div className="mt-1 text-xl font-semibold">{latest ? `${fmtNum(latest.storageUsedPct)}%` : '-'}</div>
          </div>
          <div className="rounded-md border border-[#2a2d2e] bg-[#252526] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-textMuted">Threads</div>
            <div className="mt-1 text-xl font-semibold">
              {latest ? `${latest.threadActiveHandles} / ${latest.threadActiveRequests}` : '-'}
            </div>
          </div>
          <div className="rounded-md border border-[#2a2d2e] bg-[#252526] px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-textMuted">Alerts</div>
            <div className="mt-1 text-xl font-semibold">{summary?.alerts?.totalInWindow ?? 0}</div>
          </div>
        </div>

        <div className="grid gap-3 2xl:grid-cols-2">
          <TimelineChart
            title="Global: CPU & Error Rate"
            subtitle="System-wide load trend"
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
            title="Global: Memory"
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
            title="Global: Network"
            subtitle="Inbound and outbound traffic"
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
            title="Global: Threads & Storage"
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

        <DataCard title="Servers" subtitle="Active servers" className="border border-[#2a2d2e] bg-[#252526] p-3">
          <DataTable headers={['Server', 'Inst', 'CPU', 'Error']} loading={loadingSummary}>
            {(summary?.servers || []).map((server) => (
              <tr key={server.serverName} className="hover:bg-bgApp transition">
                <td className="px-3 py-2 text-textPrimary">{server.serverName}</td>
                <td className="px-3 py-2 text-textMuted">{server.instanceCount}</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(server.avgCpuPercent)}%</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(server.avgErrorRatePct)}%</td>
              </tr>
            ))}
          </DataTable>
        </DataCard>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin/monitoring/instances" className="rounded border border-[#3c3c3c] px-3 py-1 text-textMuted hover:bg-[#2a2d2e] hover:text-textPrimary">Open Instances</Link>
          <Link href="/admin/monitoring/tenants" className="rounded border border-[#3c3c3c] px-3 py-1 text-textMuted hover:bg-[#2a2d2e] hover:text-textPrimary">Open Tenants</Link>
          <Link href="/admin/monitoring/alerts" className="rounded border border-[#3c3c3c] px-3 py-1 text-textMuted hover:bg-[#2a2d2e] hover:text-textPrimary">Open Alerts</Link>
        </div>
      </div>
    </MonitoringLayout>
  );
}
