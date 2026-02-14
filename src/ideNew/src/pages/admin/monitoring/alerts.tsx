import { DataCard } from '@/components/ui/DataCard';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { TextArea } from '@/components/ui/TextArea';
import MonitoringLayout from '@/components/monitoring/MonitoringLayout';
import { fmtDate, fmtNum, severityTone } from '@/components/monitoring/format';
import { useMonitoringData } from '@/components/monitoring/useMonitoringData';
import {
  MONITORING_METRIC_OPTIONS,
  MONITORING_OPERATOR_OPTIONS,
  MONITORING_SCOPE_OPTIONS,
  MONITORING_SEVERITY_OPTIONS,
  metricLabel,
} from '@/lib/monitoring';
import { defaultRuleForm } from '@/components/monitoring/types';

export default function MonitoringAlertsPage() {
  const {
    windowMinutes,
    setWindowMinutes,
    refreshAll,
    error,
    success,
    loadingRules,
    loadingEvents,
    rules,
    events,
    form,
    setForm,
    submitRule,
    editRule,
    removeRule,
    tenantOptions,
  } = useMonitoringData();

  return (
    <MonitoringLayout
      title="Alerts & Webhooks"
      subtitle="Threshold rules and event triggers"
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

        <DataCard title="Alert Rules" subtitle="Threshold and webhook policy" className="border border-[#2a2d2e] bg-[#252526] p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="Rule Name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="High CPU"
            />
            <Select
              label="Scope"
              value={form.scope}
              onChange={(e) => setForm((prev) => ({ ...prev, scope: e.target.value as typeof form.scope }))}
              options={MONITORING_SCOPE_OPTIONS.map((item) => ({ label: item.label, value: item.value }))}
            />
            <Select
              label="Metric"
              value={form.metricKey}
              onChange={(e) => setForm((prev) => ({ ...prev, metricKey: e.target.value }))}
              options={MONITORING_METRIC_OPTIONS.filter((item) => form.scope === 'tenant' || item.scope !== 'tenant').map((item) => ({
                label: item.label,
                value: item.value,
              }))}
            />
            <Select
              label="Operator"
              value={form.operator}
              onChange={(e) => setForm((prev) => ({ ...prev, operator: e.target.value as typeof form.operator }))}
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
              onChange={(e) => setForm((prev) => ({ ...prev, severity: e.target.value as typeof form.severity }))}
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
        </DataCard>

        <DataCard title="Rule List" subtitle="Current alert rules" className="border border-[#2a2d2e] bg-[#252526] p-3">
          <DataTable
            headers={['Name', 'Scope', 'Metric', 'Condition', 'Severity', 'Webhook', 'Actions']}
            loading={loadingRules}
            emptyMessage="No alert rules configured"
          >
            {rules.map((rule) => (
              <tr key={rule.id} className="hover:bg-bgApp transition">
                <td className="px-3 py-2 text-textPrimary">
                  {rule.name}
                  {!rule.enabled && <span className="ml-2 text-xs text-textMuted">(disabled)</span>}
                </td>
                <td className="px-3 py-2 text-textMuted">{rule.scope}</td>
                <td className="px-3 py-2 text-textMuted">{metricLabel(rule.metricKey)}</td>
                <td className="px-3 py-2 text-textMuted">
                  {rule.operator} {rule.threshold}
                </td>
                <td className={`px-3 py-2 ${severityTone(rule.severity)}`}>{rule.severity}</td>
                <td className="px-3 py-2 text-textMuted">{rule.webhookUrl ? 'Yes' : 'No'}</td>
                <td className="px-3 py-2">
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
        </DataCard>

        <DataCard title="Alert Events" subtitle="Recent trigger history" className="border border-[#2a2d2e] bg-[#252526] p-3">
          <DataTable
            headers={['Time', 'Severity', 'Metric', 'Value', 'Target', 'Instance', 'Webhook']}
            loading={loadingEvents}
            emptyMessage="No alert events in selected window"
          >
            {events.map((event) => (
              <tr key={event.id} className="hover:bg-bgApp transition">
                <td className="px-3 py-2 text-textMuted">{fmtDate(event.createdAt)}</td>
                <td className={`px-3 py-2 ${severityTone(event.severity)}`}>{event.severity}</td>
                <td className="px-3 py-2 text-textMuted">{metricLabel(event.metricKey)}</td>
                <td className="px-3 py-2 text-textMuted">
                  {fmtNum(event.metricValue)} ({event.operator} {fmtNum(event.threshold)})
                </td>
                <td className="px-3 py-2 text-textMuted">{event.tenantHostname || event.tenantId || '-'}</td>
                <td className="px-3 py-2 text-textMuted">{event.instanceName || event.instanceId}</td>
                <td className="px-3 py-2 text-textMuted">{event.webhookStatus || '-'}</td>
              </tr>
            ))}
          </DataTable>
        </DataCard>
      </div>
    </MonitoringLayout>
  );
}
