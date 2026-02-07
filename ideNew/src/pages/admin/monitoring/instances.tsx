import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Select';
import MonitoringLayout from '@/components/monitoring/MonitoringLayout';
import TimelineChart from '@/components/monitoring/TimelineChart';
import { fmtBytes, fmtDate, fmtNum } from '@/components/monitoring/format';
import { useMonitoringData } from '@/components/monitoring/useMonitoringData';

export default function MonitoringInstancesPage() {
  const {
    windowMinutes,
    setWindowMinutes,
    refreshAll,
    error,
    summary,
    loadingSummary,
    instanceSeries,
    selectedInstanceKey,
    setSelectedInstanceKey,
    selectedInstanceSeries,
    instanceChartLabels,
  } = useMonitoringData();

  return (
    <MonitoringLayout
      title="Instance Monitoring"
      subtitle="Server/node-level charts and stats"
      windowMinutes={windowMinutes}
      onWindowChange={setWindowMinutes}
      onRefresh={() => void refreshAll()}
    >
      <div className="space-y-3">
        {error && (
          <div className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        <DataCard
          title="Instance Scope"
          subtitle="Per-instance trends"
          className="border border-[#2a2d2e] bg-[#252526] p-3"
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
          <div className="grid gap-3 2xl:grid-cols-2">
            <TimelineChart
              title="Instance: CPU/Errors"
              subtitle="Load and reliability"
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
              title="Instance: Memory/Network"
              subtitle="Memory and traffic"
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
            <TimelineChart
              title="Instance: Threads"
              subtitle="Event loop pressure"
              labels={instanceChartLabels}
              datasets={[
                {
                  label: 'Active Handles',
                  data: (selectedInstanceSeries?.points || []).map((point) => Number(point.threadActiveHandles) || 0),
                  borderColor: '#f97316',
                },
                {
                  label: 'Active Requests',
                  data: (selectedInstanceSeries?.points || []).map((point) => Number(point.threadActiveRequests) || 0),
                  borderColor: '#fde047',
                },
              ]}
            />
            <TimelineChart
              title="Instance: Storage"
              subtitle="Used storage percentage"
              labels={instanceChartLabels}
              datasets={[
                {
                  label: 'Storage %',
                  data: (selectedInstanceSeries?.points || []).map((point) => Number(point.storageUsedPct) || 0),
                  borderColor: '#10b981',
                },
              ]}
            />
          </div>
        </DataCard>

        <DataCard title="Instance Table" subtitle="Latest per instance" className="border border-[#2a2d2e] bg-[#252526] p-3">
          <DataTable
            headers={['Server', 'Instance', 'CPU', 'Memory RSS', 'Storage', 'Network In', 'Network Out', 'Updated']}
            loading={loadingSummary}
          >
            {(summary?.instances || []).map((inst) => (
              <tr key={`${inst.serverName}:${inst.instanceId}`} className="hover:bg-bgApp transition">
                <td className="px-3 py-2 text-textPrimary">{inst.serverName}</td>
                <td className="px-3 py-2 text-textMuted">{inst.instanceName || inst.instanceId}</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(inst.cpuPercent)}%</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(inst.memoryRssMb)} MB</td>
                <td className="px-3 py-2 text-textMuted">{fmtNum(inst.storageUsedPct)}%</td>
                <td className="px-3 py-2 text-textMuted">{fmtBytes(inst.networkInBytes)}</td>
                <td className="px-3 py-2 text-textMuted">{fmtBytes(inst.networkOutBytes)}</td>
                <td className="px-3 py-2 text-textMuted">{fmtDate(inst.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        </DataCard>
      </div>
    </MonitoringLayout>
  );
}
