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

const normalizePayload = (body: Record<string, unknown>) => {
  const name = asString(body.name);
  if (!name) {
    const err = new Error('Rule name is required');
    (err as any).statusCode = 400;
    throw err;
  }

  const scope = asString(body.scope) || 'global';
  if (!isMonitoringScope(scope)) {
    const err = new Error('Invalid scope');
    (err as any).statusCode = 400;
    throw err;
  }

  const metricKey = asString(body.metricKey);
  if (!isMonitoringMetric(metricKey)) {
    const err = new Error('Invalid metric key');
    (err as any).statusCode = 400;
    throw err;
  }

  const metric = MONITORING_METRIC_OPTIONS.find((item) => item.value === metricKey);
  if (!metric) {
    const err = new Error('Invalid metric key');
    (err as any).statusCode = 400;
    throw err;
  }
  if (metric.scope === 'tenant' && scope !== 'tenant') {
    const err = new Error('Tenant metrics require tenant scope');
    (err as any).statusCode = 400;
    throw err;
  }

  const operator = asString(body.operator) || 'gte';
  if (!isMonitoringOperator(operator)) {
    const err = new Error('Invalid operator');
    (err as any).statusCode = 400;
    throw err;
  }

  const severity = asString(body.severity) || 'warning';
  if (!isMonitoringSeverity(severity)) {
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

  const enabledRaw = body.enabled;
  const enabled =
    typeof enabledRaw === 'boolean'
      ? enabledRaw
      : typeof enabledRaw === 'string'
      ? enabledRaw !== 'false'
      : true;

  const cooldownSec = Number(body.cooldownSec);

  return {
    name,
    enabled,
    scope: scope as MonitoringRule['scope'],
    tenantId: scope === 'tenant' ? asString(body.tenantId) || null : null,
    metricKey,
    operator: operator as MonitoringRule['operator'],
    threshold,
    cooldownSec: Number.isFinite(cooldownSec) ? Math.max(Math.floor(cooldownSec), 0) : 300,
    severity: severity as MonitoringRule['severity'],
    webhookUrl: asString(body.webhookUrl) || null,
    webhookMethod: (asString(body.webhookMethod) || 'POST').toUpperCase(),
    webhookHeaders: parseHeaders(body.webhookHeaders),
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

  const id = asString(req.query.id);
  if (!id) {
    res.status(400).json({ error: 'Rule id is required' });
    return;
  }

  const rules = await monitoringStore.readRules();
  const existing = rules.find((rule) => rule.id === id);
  if (!existing) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  if (req.method === 'PUT') {
    const payload = normalizePayload((req.body || {}) as Record<string, unknown>);
    const updated = await monitoringStore.updateRule(id, payload);
    if (!updated) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(200).json({ rule: serialize(updated) });
    return;
  }

  if (req.method === 'DELETE') {
    const deleted = await monitoringStore.deleteRule(id);
    if (!deleted) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  res.status(405).end();
});
