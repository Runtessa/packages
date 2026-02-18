const { normalizeInstanceName, isObject } = require('./utils');

const isValidSnapshot = (value) => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.serverName === 'string' &&
    typeof value.instanceId === 'string' &&
    Array.isArray(value.tenantSamples)
  );
};

const isValidAlert = (value) => {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.serverName === 'string' &&
    typeof value.instanceId === 'string' &&
    typeof value.metricKey === 'string'
  );
};

const normalizeSnapshot = (snapshot) => ({
  ...snapshot,
  instanceName: normalizeInstanceName(snapshot.instanceName, snapshot.instanceId),
});

const normalizeAlert = (alert) => ({
  ...alert,
  instanceName: normalizeInstanceName(alert.instanceName, alert.instanceId),
});

module.exports = {
  isValidSnapshot,
  isValidAlert,
  normalizeSnapshot,
  normalizeAlert,
};
