import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { requireAdmin } from '@/lib/auth';
import {
  MONITORING_METRIC_OPTIONS,
  isMonitoringMetric,
  isMonitoringOperator,
  isMonitoringScope,
  isMonitoringSeverity,
} from '@/lib/monitoring';
import { monitoringStore, MonitoringRule } from '@/lib/monitoring-store';

const asString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : Array.isArray(value) ? String(value[0] || '').trim() : '';

const parseHeaders = (raw: unknown): Record<string, string> | null => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]));
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k), String(v)]));
  }
  return null;
};

const normalizeRulePayload = (body: Record<string, unknown>) => {
  const name = asString(body.name);
  if (!name) {
    const err = new Error('Rule name is required');
    (err as any).statusCode = 400;
    throw err;
  }

  const scopeRaw = asString(body.scope) || 'global';
  if (!isMonitoringScope(scopeRaw)) {
    const err = new Error('Invalid scope');
    (err as any).statusCode = 400;
    throw err;
  }

  const metricKeyRaw = asString(body.metricKey);
  if (!isMonitoringMetric(metricKeyRaw)) {
    const err = new Error('Invalid metric key');
    (err as any).statusCode = 400;
    throw err;
  }

  const metric = MONITORING_METRIC_OPTIONS.find((item) => item.value === metricKeyRaw);
  if (!metric) {
    const err = new Error('Invalid metric key');
    (err as any).statusCode = 400;
    throw err;
  }

  const scope = scopeRaw as MonitoringRule['scope'];
  if (metric.scope === 'tenant' && scope !== 'tenant') {
    const err = new Error('Tenant metrics require tenant scope');
    (err as any).statusCode = 400;
    throw err;
  }

  const operatorRaw = asString(body.operator) || 'gte';
  if (!isMonitoringOperator(operatorRaw)) {
    const err = new Error('Invalid operator');
    (err as any).statusCode = 400;
    throw err;
  }

  const severityRaw = asString(body.severity) || 'warning';
  if (!isMonitoringSeverity(severityRaw)) {
    const err = new Error('Invalid severity');
    (err as any).statusCode = 400;
    throw err;
  }

  const threshold = Number(body.threshold);
  if (!Number.isFinite(threshold)) {
    const err = new Error('Threshold must be numeric');
    (err as any).statusCode = 400;
    throw err;
  }

  const cooldownSec = Number(body.cooldownSec);
  const enabledRaw = body.enabled;
  const enabled =
    typeof enabledRaw === 'boolean'
      ? enabledRaw
      : typeof enabledRaw === 'string'
      ? enabledRaw !== 'false'
      : true;

  const webhookUrl = asString(body.webhookUrl) || null;
  const webhookMethod = (asString(body.webhookMethod) || 'POST').toUpperCase();
  const webhookHeaders = parseHeaders(body.webhookHeaders);

  const tenantId = asString(body.tenantId) || null;

  return {
    name,
    enabled,
    scope,
    tenantId: scope === 'tenant' ? tenantId : null,
    metricKey: metricKeyRaw,
    operator: operatorRaw as MonitoringRule['operator'],
    threshold,
    cooldownSec: Number.isFinite(cooldownSec) ? Math.max(Math.floor(cooldownSec), 0) : 300,
    severity: severityRaw as MonitoringRule['severity'],
    webhookUrl,
    webhookMethod,
    webhookHeaders,
  };
};

const serialize = (rule: MonitoringRule) => ({
  id: rule.id,
  name: rule.name,
  enabled: rule.enabled,
  scope: rule.scope,
  tenantId: rule.tenantId || null,
  metricKey: rule.metricKey,
  operator: rule.operator,
  threshold: rule.threshold,
  cooldownSec: rule.cooldownSec,
  severity: rule.severity,
  webhookUrl: rule.webhookUrl || null,
  webhookMethod: rule.webhookMethod || 'POST',
  webhookHeaders: rule.webhookHeaders || null,
  createdAt: rule.createdAt,
  updatedAt: rule.updatedAt,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  await requireAdmin(req);

  if (req.method === 'GET') {
    const rules = await monitoringStore.readRules();
    rules.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    res.status(200).json({ rules: rules.map(serialize) });
    return;
  }

  if (req.method === 'POST') {
    const payload = normalizeRulePayload((req.body || {}) as Record<string, unknown>);
    const created = await monitoringStore.createRule(payload);
    res.status(201).json({ rule: serialize(created) });
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end();
});
