const KEY = {
  instances: 'monitoring:instances',
  rulesIds: 'monitoring:rules:ids',
  rulesData: 'monitoring:rules:data',
  meta: (instanceKey) => `monitoring:instance:${instanceKey}:meta`,
  heartbeat: (instanceKey) => `monitoring:instance:${instanceKey}:heartbeat`,
  snapshots: (instanceKey) => `monitoring:snapshots:${instanceKey}`,
  alerts: 'monitoring:alerts',
};

const DEFAULTS = {
  snapshotRetention: 21600,
  alertRetention: 5000,
  instanceTtlSec: 30,
  tlsRequired: true,
};

const MONITORING_SCOPE_OPTIONS = ['global', 'instance', 'tenant'];
const MONITORING_OPERATOR_OPTIONS = ['gt', 'gte', 'lt', 'lte'];
const MONITORING_SEVERITY_OPTIONS = ['info', 'warning', 'critical'];
const MONITORING_METRIC_OPTIONS = [
  { value: 'cpu_percent', scope: 'global' },
  { value: 'memory_rss_mb', scope: 'global' },
  { value: 'memory_heap_used_mb', scope: 'global' },
  { value: 'event_loop_lag_ms', scope: 'global' },
  { value: 'error_rate_pct', scope: 'global' },
  { value: 'storage_used_pct', scope: 'global' },
  { value: 'thread_active_handles', scope: 'global' },
  { value: 'thread_active_requests', scope: 'global' },
  { value: 'network_in_bytes', scope: 'global' },
  { value: 'network_out_bytes', scope: 'global' },
  { value: 'tenant_request_count', scope: 'tenant' },
  { value: 'tenant_error_rate_pct', scope: 'tenant' },
  { value: 'tenant_avg_latency_ms', scope: 'tenant' },
  { value: 'tenant_p95_latency_ms', scope: 'tenant' },
  { value: 'tenant_max_latency_ms', scope: 'tenant' },
  { value: 'tenant_network_in_bytes', scope: 'tenant' },
  { value: 'tenant_network_out_bytes', scope: 'tenant' },
];

module.exports = {
  KEY,
  DEFAULTS,
  MONITORING_SCOPE_OPTIONS,
  MONITORING_OPERATOR_OPTIONS,
  MONITORING_SEVERITY_OPTIONS,
  MONITORING_METRIC_OPTIONS,
};
