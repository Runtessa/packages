export const MONITORING_SCOPE_OPTIONS = [
  { label: 'Global', value: 'global' },
  { label: 'Instance', value: 'instance' },
  { label: 'Tenant', value: 'tenant' },
] as const;

export const MONITORING_OPERATOR_OPTIONS = [
  { label: '>', value: 'gt' },
  { label: '>=', value: 'gte' },
  { label: '<', value: 'lt' },
  { label: '<=', value: 'lte' },
] as const;

export const MONITORING_SEVERITY_OPTIONS = [
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Critical', value: 'critical' },
] as const;

export const MONITORING_METRIC_OPTIONS = [
  { label: 'CPU (%)', value: 'cpu_percent', scope: 'global', unit: '%' },
  { label: 'Memory RSS (MB)', value: 'memory_rss_mb', scope: 'global', unit: 'MB' },
  { label: 'Heap Used (MB)', value: 'memory_heap_used_mb', scope: 'global', unit: 'MB' },
  { label: 'Event Loop Lag (ms)', value: 'event_loop_lag_ms', scope: 'global', unit: 'ms' },
  { label: 'Error Rate (%)', value: 'error_rate_pct', scope: 'global', unit: '%' },
  { label: 'Storage Used (%)', value: 'storage_used_pct', scope: 'global', unit: '%' },
  { label: 'Active Handles', value: 'thread_active_handles', scope: 'global', unit: 'count' },
  { label: 'Active Requests', value: 'thread_active_requests', scope: 'global', unit: 'count' },
  { label: 'Network In (bytes/window)', value: 'network_in_bytes', scope: 'global', unit: 'bytes' },
  { label: 'Network Out (bytes/window)', value: 'network_out_bytes', scope: 'global', unit: 'bytes' },
  { label: 'Tenant Request Count', value: 'tenant_request_count', scope: 'tenant', unit: 'count' },
  { label: 'Tenant Error Rate (%)', value: 'tenant_error_rate_pct', scope: 'tenant', unit: '%' },
  { label: 'Tenant Avg Latency (ms)', value: 'tenant_avg_latency_ms', scope: 'tenant', unit: 'ms' },
  { label: 'Tenant P95 Latency (ms)', value: 'tenant_p95_latency_ms', scope: 'tenant', unit: 'ms' },
  { label: 'Tenant Max Latency (ms)', value: 'tenant_max_latency_ms', scope: 'tenant', unit: 'ms' },
  { label: 'Tenant Network In (bytes/window)', value: 'tenant_network_in_bytes', scope: 'tenant', unit: 'bytes' },
  { label: 'Tenant Network Out (bytes/window)', value: 'tenant_network_out_bytes', scope: 'tenant', unit: 'bytes' },
] as const;

export type MonitoringScope = (typeof MONITORING_SCOPE_OPTIONS)[number]['value'];
export type MonitoringOperator = (typeof MONITORING_OPERATOR_OPTIONS)[number]['value'];
export type MonitoringSeverity = (typeof MONITORING_SEVERITY_OPTIONS)[number]['value'];
export type MonitoringMetricKey = (typeof MONITORING_METRIC_OPTIONS)[number]['value'];

export const isMonitoringScope = (value: string): value is MonitoringScope =>
  MONITORING_SCOPE_OPTIONS.some((item) => item.value === value);

export const isMonitoringOperator = (value: string): value is MonitoringOperator =>
  MONITORING_OPERATOR_OPTIONS.some((item) => item.value === value);

export const isMonitoringSeverity = (value: string): value is MonitoringSeverity =>
  MONITORING_SEVERITY_OPTIONS.some((item) => item.value === value);

export const isMonitoringMetric = (value: string): value is MonitoringMetricKey =>
  MONITORING_METRIC_OPTIONS.some((item) => item.value === value);

export const metricLabel = (key: string) =>
  MONITORING_METRIC_OPTIONS.find((item) => item.value === key)?.label || key;
