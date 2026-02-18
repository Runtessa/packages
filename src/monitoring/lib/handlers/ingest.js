const { DEFAULTS } = require('../constants');
const { parseIntBounded, isObject } = require('../utils');
const { isValidSnapshot, isValidAlert, normalizeSnapshot, normalizeAlert } = require('../models');
const { ingestSnapshot, ingestAlert } = require('../redisStore');

const ingestHandler = async (req, res) => {
  const payload = isObject(req.body) ? req.body : {};
  const snapshots = [payload.snapshot, ...(Array.isArray(payload.snapshots) ? payload.snapshots : [])]
    .filter(isValidSnapshot)
    .map(normalizeSnapshot);

  const alerts = [payload.alert, ...(Array.isArray(payload.alerts) ? payload.alerts : [])]
    .filter(isValidAlert)
    .map(normalizeAlert);

  if (!snapshots.length && !alerts.length) {
    res.status(400).json({ error: 'No valid snapshot or alert payloads' });
    return;
  }

  const snapshotRetention = parseIntBounded(
    payload.snapshotRetention,
    DEFAULTS.snapshotRetention,
    100,
    30000,
  );
  const alertRetention = parseIntBounded(payload.alertRetention, DEFAULTS.alertRetention, 100, 50000);
  const heartbeatTtlSec = parseIntBounded(
    process.env.MONITORING_INSTANCE_TTL_SEC,
    DEFAULTS.instanceTtlSec,
    10,
    300,
  );

  await Promise.all([
    ...snapshots.map((snapshot) => ingestSnapshot(snapshot, snapshotRetention, heartbeatTtlSec)),
    ...alerts.map((alert) => ingestAlert(alert, alertRetention)),
  ]);

  res.status(200).json({
    ok: true,
    ingested: {
      snapshots: snapshots.length,
      alerts: alerts.length,
    },
  });
};

module.exports = {
  ingestHandler,
};
