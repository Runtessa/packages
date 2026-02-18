const {
  MONITORING_METRIC_OPTIONS,
} = require('./constants');
const {
  str,
  parseHeaders,
  isMonitoringScope,
  isMonitoringOperator,
  isMonitoringSeverity,
  isMonitoringMetric,
} = require('./utils');

const serializeRule = (rule) => ({
  id: rule.id,
  name: rule.name,
  enabled: Boolean(rule.enabled),
  scope: rule.scope,
  tenantId: rule.tenantId || null,
  metricKey: rule.metricKey,
  operator: rule.operator,
  threshold: Number(rule.threshold) || 0,
  cooldownSec: Number(rule.cooldownSec) || 0,
  severity: rule.severity,
  webhookUrl: rule.webhookUrl || null,
  webhookMethod: rule.webhookMethod || 'POST',
  webhookHeaders: rule.webhookHeaders || null,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

const normalizeRulePayload = (body) => {
  const name = str(body?.name).trim();
  if (!name) {
    const err = new Error('Rule name is required');
    err.statusCode = 400;
    throw err;
  }

  const scopeRaw = str(body?.scope).trim() || 'global';
  if (!isMonitoringScope(scopeRaw)) {
    const err = new Error('Invalid scope');
    err.statusCode = 400;
    throw err;
  }

  const metricKeyRaw = str(body?.metricKey).trim();
  if (!isMonitoringMetric(metricKeyRaw)) {
    const err = new Error('Invalid metric key');
    err.statusCode = 400;
    throw err;
  }

  const metric = MONITORING_METRIC_OPTIONS.find((item) => item.value === metricKeyRaw);
  if (!metric) {
    const err = new Error('Invalid metric key');
    err.statusCode = 400;
    throw err;
  }

  const scope = scopeRaw;
  if (metric.scope === 'tenant' && scope !== 'tenant') {
    const err = new Error('Tenant metrics require tenant scope');
    err.statusCode = 400;
    throw err;
  }

  const operatorRaw = str(body?.operator).trim() || 'gte';
  if (!isMonitoringOperator(operatorRaw)) {
    const err = new Error('Invalid operator');
    err.statusCode = 400;
    throw err;
  }

  const severityRaw = str(body?.severity).trim() || 'warning';
  if (!isMonitoringSeverity(severityRaw)) {
    const err = new Error('Invalid severity');
    err.statusCode = 400;
    throw err;
  }

  const threshold = Number(body?.threshold);
  if (!Number.isFinite(threshold)) {
    const err = new Error('Threshold must be numeric');
    err.statusCode = 400;
    throw err;
  }

  const cooldownSec = Number(body?.cooldownSec);
  const enabledRaw = body?.enabled;
  const enabled =
    typeof enabledRaw === 'boolean'
      ? enabledRaw
      : typeof enabledRaw === 'string'
      ? enabledRaw !== 'false'
      : true;

  const webhookUrl = str(body?.webhookUrl).trim() || null;
  const webhookMethod = (str(body?.webhookMethod).trim() || 'POST').toUpperCase();
  const webhookHeaders = parseHeaders(body?.webhookHeaders);
  const tenantId = str(body?.tenantId).trim() || null;

  return {
    name,
    enabled,
    scope,
    tenantId: scope === 'tenant' ? tenantId : null,
    metricKey: metricKeyRaw,
    operator: operatorRaw,
    threshold,
    cooldownSec: Number.isFinite(cooldownSec) ? Math.max(Math.floor(cooldownSec), 0) : 300,
    severity: severityRaw,
    webhookUrl,
    webhookMethod,
    webhookHeaders,
  };
};

module.exports = {
  serializeRule,
  normalizeRulePayload,
};
