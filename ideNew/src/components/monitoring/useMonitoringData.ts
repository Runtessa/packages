import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchJson } from '@/lib/client/api';
import { useSessionToken } from '@/lib/client/session';
import type { AlertEvent, Rule, RuleForm, SummaryResponse } from './types';
import { defaultRuleForm } from './types';

export function useMonitoringData() {
  const { token, ready } = useSessionToken();
  const [windowMinutes, setWindowMinutes] = useState(60);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState<RuleForm>(defaultRuleForm);
  const [selectedInstanceKey, setSelectedInstanceKey] = useState('');
  const [selectedTenantKey, setSelectedTenantKey] = useState('');

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setLoadingSummary(true);
    setError('');
    try {
      const data = (await fetchJson(`/api/admin/monitoring/summary?minutes=${windowMinutes}`, {
        token,
      })) as SummaryResponse;
      setSummary(data);
      setEvents(data.alerts?.recent || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load monitoring summary');
    } finally {
      setLoadingSummary(false);
    }
  }, [token, windowMinutes]);

  const loadRules = useCallback(async () => {
    if (!token) return;
    setLoadingRules(true);
    setError('');
    try {
      const data = await fetchJson('/api/admin/monitoring/rules', { token });
      setRules(data.rules || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load alert rules');
    } finally {
      setLoadingRules(false);
    }
  }, [token]);

  const loadEvents = useCallback(async () => {
    if (!token) return;
    setLoadingEvents(true);
    setError('');
    try {
      const data = await fetchJson(`/api/admin/monitoring/events?minutes=${windowMinutes}&limit=50`, {
        token,
      });
      setEvents(data.events || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load alert events');
    } finally {
      setLoadingEvents(false);
    }
  }, [token, windowMinutes]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadRules(), loadEvents()]);
  }, [loadSummary, loadRules, loadEvents]);

  useEffect(() => {
    if (!ready || !token) return;
    void refreshAll();
  }, [ready, token, refreshAll]);

  useEffect(() => {
    if (!ready || !token) return;
    const timer = setInterval(() => {
      void Promise.all([loadSummary(), loadEvents()]);
    }, 4000);
    return () => clearInterval(timer);
  }, [ready, token, loadSummary, loadEvents]);

  const timelinePoints = useMemo(
    () =>
      (summary?.points || []).slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [summary?.points]
  );

  const globalChartLabels = useMemo(
    () => timelinePoints.map((point) => new Date(point.createdAt).toLocaleTimeString()),
    [timelinePoints]
  );

  const instanceSeries = summary?.instanceSeries || [];
  const tenantSeries = summary?.tenantSeries || [];

  useEffect(() => {
    if (!instanceSeries.length) {
      setSelectedInstanceKey('');
      return;
    }
    if (!selectedInstanceKey || !instanceSeries.some((series) => series.key === selectedInstanceKey)) {
      setSelectedInstanceKey(instanceSeries[0].key);
    }
  }, [instanceSeries, selectedInstanceKey]);

  useEffect(() => {
    if (!tenantSeries.length) {
      setSelectedTenantKey('');
      return;
    }
    if (!selectedTenantKey || !tenantSeries.some((series) => series.key === selectedTenantKey)) {
      setSelectedTenantKey(tenantSeries[0].key);
    }
  }, [tenantSeries, selectedTenantKey]);

  const selectedInstanceSeries = useMemo(
    () => instanceSeries.find((series) => series.key === selectedInstanceKey) || null,
    [instanceSeries, selectedInstanceKey]
  );

  const selectedTenantSeries = useMemo(
    () => tenantSeries.find((series) => series.key === selectedTenantKey) || null,
    [tenantSeries, selectedTenantKey]
  );

  const instanceChartLabels = useMemo(
    () =>
      (selectedInstanceSeries?.points || []).map((point) =>
        new Date(point.createdAt).toLocaleTimeString()
      ),
    [selectedInstanceSeries]
  );

  const tenantChartLabels = useMemo(
    () =>
      (selectedTenantSeries?.points || []).map((point) =>
        new Date(point.createdAt).toLocaleTimeString()
      ),
    [selectedTenantSeries]
  );

  const tenantOptions = useMemo(
    () =>
      (summary?.tenants || [])
        .filter((item) => item.tenantId)
        .map((item) => ({
          label: item.tenantHostname || item.tenantId || 'Tenant',
          value: item.tenantId as string,
        })),
    [summary?.tenants]
  );

  const submitRule = useCallback(async () => {
    if (!token) return;
    setError('');
    setSuccess('');

    try {
      const payload = {
        name: form.name,
        enabled: form.enabled,
        scope: form.scope,
        tenantId: form.scope === 'tenant' ? form.tenantId : null,
        metricKey: form.metricKey,
        operator: form.operator,
        threshold: Number(form.threshold),
        cooldownSec: Number(form.cooldownSec),
        severity: form.severity,
        webhookUrl: form.webhookUrl || null,
        webhookMethod: form.webhookMethod || 'POST',
        webhookHeaders: form.webhookHeaders || null,
      };

      if (form.id) {
        await fetchJson(`/api/admin/monitoring/rules/${form.id}`, {
          token,
          method: 'PUT',
          body: payload,
        });
        setSuccess('Alert rule updated');
      } else {
        await fetchJson('/api/admin/monitoring/rules', {
          token,
          method: 'POST',
          body: payload,
        });
        setSuccess('Alert rule created');
      }

      setForm(defaultRuleForm);
      await Promise.all([loadRules(), loadSummary()]);
    } catch (err: any) {
      setError(err.message || 'Failed to save rule');
    }
  }, [token, form, loadRules, loadSummary]);

  const editRule = useCallback((rule: Rule) => {
    setForm({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      scope: rule.scope,
      tenantId: rule.tenantId || '',
      metricKey: rule.metricKey,
      operator: rule.operator,
      threshold: String(rule.threshold),
      cooldownSec: String(rule.cooldownSec),
      severity: rule.severity,
      webhookUrl: rule.webhookUrl || '',
      webhookMethod: rule.webhookMethod || 'POST',
      webhookHeaders: rule.webhookHeaders ? JSON.stringify(rule.webhookHeaders, null, 2) : '',
    });
  }, []);

  const removeRule = useCallback(
    async (ruleId: string) => {
      if (!token) return;
      setError('');
      setSuccess('');
      try {
        await fetchJson(`/api/admin/monitoring/rules/${ruleId}`, {
          token,
          method: 'DELETE',
        });
        setSuccess('Rule deleted');
        if (form.id === ruleId) setForm(defaultRuleForm);
        await Promise.all([loadRules(), loadSummary()]);
      } catch (err: any) {
        setError(err.message || 'Failed to delete rule');
      }
    },
    [token, form.id, loadRules, loadSummary]
  );

  return {
    ready,
    token,
    windowMinutes,
    setWindowMinutes,
    summary,
    rules,
    events,
    loadingSummary,
    loadingRules,
    loadingEvents,
    error,
    setError,
    success,
    setSuccess,
    form,
    setForm,
    timelinePoints,
    globalChartLabels,
    instanceSeries,
    tenantSeries,
    selectedInstanceKey,
    setSelectedInstanceKey,
    selectedTenantKey,
    setSelectedTenantKey,
    selectedInstanceSeries,
    selectedTenantSeries,
    instanceChartLabels,
    tenantChartLabels,
    tenantOptions,
    loadSummary,
    loadRules,
    loadEvents,
    refreshAll,
    submitRule,
    editRule,
    removeRule,
  };
}
