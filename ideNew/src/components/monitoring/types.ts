export type Snapshot = {
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

export type TenantSummary = {
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

export type Rule = {
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

export type AlertEvent = {
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

export type SummaryPoint = {
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
};

export type SummaryResponse = {
  points: SummaryPoint[];
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
    points: SummaryPoint[];
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

export type RuleForm = {
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

export type ChartDataset = {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor?: string;
  yAxisID?: string;
};

export const defaultRuleForm: RuleForm = {
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
