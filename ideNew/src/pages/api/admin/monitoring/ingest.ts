import { NextApiRequest, NextApiResponse } from 'next';
import { withApiHandler } from '@/lib/api-helpers';
import { monitoringStore, MonitoringAlertEvent, MonitoringSnapshot } from '@/lib/monitoring-store';

const asBearer = (header: string | undefined) => {
  if (!header) return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const isValidSnapshot = (value: unknown): value is MonitoringSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const row = value as MonitoringSnapshot;
  return (
    typeof row.id === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.serverName === 'string' &&
    typeof row.instanceId === 'string' &&
    Array.isArray(row.tenantSamples)
  );
};

const isValidAlert = (value: unknown): value is MonitoringAlertEvent => {
  if (!value || typeof value !== 'object') return false;
  const row = value as MonitoringAlertEvent;
  return (
    typeof row.id === 'string' &&
    typeof row.createdAt === 'string' &&
    typeof row.serverName === 'string' &&
    typeof row.instanceId === 'string' &&
    typeof row.metricKey === 'string'
  );
};

const normalizeSnapshot = (row: MonitoringSnapshot): MonitoringSnapshot => ({
  ...row,
  instanceName: typeof row.instanceName === 'string' && row.instanceName.trim() ? row.instanceName : row.instanceId,
});

const normalizeAlert = (row: MonitoringAlertEvent): MonitoringAlertEvent => ({
  ...row,
  instanceName: typeof row.instanceName === 'string' && row.instanceName.trim() ? row.instanceName : row.instanceId,
});

export default withApiHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).end();
    return;
  }

  const expectedToken = process.env.MONITORING_INGEST_TOKEN || process.env.MONITORING_SERVER_TOKEN || '';
  if (expectedToken) {
    const provided = asBearer(req.headers.authorization as string | undefined);
    if (!provided || provided !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const payload = (req.body || {}) as {
    snapshot?: unknown;
    alert?: unknown;
    snapshots?: unknown[];
    alerts?: unknown[];
    snapshotRetention?: unknown;
    alertRetention?: unknown;
  };

  const snapshots = [payload.snapshot, ...(Array.isArray(payload.snapshots) ? payload.snapshots : [])]
    .filter(isValidSnapshot)
    .map(normalizeSnapshot);
  const alerts = [payload.alert, ...(Array.isArray(payload.alerts) ? payload.alerts : [])]
    .filter(isValidAlert)
    .map(normalizeAlert);

  const snapshotRetentionRaw = Number(payload.snapshotRetention);
  const snapshotRetention = Number.isFinite(snapshotRetentionRaw)
    ? Math.min(Math.max(Math.floor(snapshotRetentionRaw), 100), 30_000)
    : 21600;

  const alertRetentionRaw = Number(payload.alertRetention);
  const alertRetention = Number.isFinite(alertRetentionRaw)
    ? Math.min(Math.max(Math.floor(alertRetentionRaw), 100), 50_000)
    : 5000;

  if (!snapshots.length && !alerts.length) {
    res.status(400).json({ error: 'No valid snapshot or alert payloads' });
    return;
  }

  await Promise.all([
    ...snapshots.map((snapshot) => monitoringStore.ingestSnapshot(snapshot, snapshotRetention)),
    ...alerts.map((alert) => monitoringStore.ingestAlert(alert, alertRetention)),
  ]);

  res.status(200).json({
    ok: true,
    ingested: {
      snapshots: snapshots.length,
      alerts: alerts.length,
    },
  });
});
