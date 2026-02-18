const fs = require('fs');
const express = require('express');
const Docker = require('dockerode');
const pkg = require('./package.json');
const {
  pickEnv,
  asBool,
  parseIntBounded,
  parseCsvList,
  ensureDir,
  sanitizeSegment,
  hashText,
} = require('./lib/env');
const { requireAuthFactory } = require('./lib/auth');
const { createServerFactory } = require('./lib/tls');
const {
  parseEnvList,
  parseEnvMap,
  parseExtraServices,
  parseQueryBool,
  formatContainerSummary,
  readDockerLogBuffer,
  demuxDockerLogs,
} = require('./lib/dockerHelpers');
const { createSelfMountResolver } = require('./lib/selfMounts');
const { registerRoutes } = require('./lib/routes');
const { createManagerConfig } = require('./lib/config');
const { createManagedRuntime } = require('./lib/managedRuntime');

const DEFAULT_TLS_REQUIRED = true;
const app = express();
app.use(
  express.json({
    limit:
      process.env.CONTAINER_MANAGER_PAYLOAD_LIMIT ||
      process.env.CONTAINER_AGENT_PAYLOAD_LIMIT ||
      '1mb',
  })
);

const requireAuth = requireAuthFactory({ pickEnv });
const createServer = createServerFactory({
  app,
  pickEnv,
  asBool,
  parseIntBounded,
  ensureDir,
  cwd: __dirname,
  defaultTlsRequired: DEFAULT_TLS_REQUIRED,
});

const docker = new Docker({
  socketPath: pickEnv('CONTAINER_MANAGER_SOCKET', 'CONTAINER_AGENT_SOCKET') || '/var/run/docker.sock',
});

const managerConfig = createManagerConfig({
  pickEnv,
  asBool,
  parseIntBounded,
  parseCsvList,
  sanitizeSegment,
  hashText,
  parseExtraServices,
});

const { resolveCodexWorkspaceHostPath, resolveCodexGatewayIndexHostPath } =
  createSelfMountResolver({
    docker,
    pickEnv,
    codexWorkspaceRoot: managerConfig.codexWorkspaceRoot,
    codexGatewayIndexPath: managerConfig.codexGatewayIndexPath,
    codexGatewayIndexHostPath: managerConfig.codexGatewayIndexHostPath,
  });

const managedRuntime = createManagedRuntime({
  fs,
  docker,
  pickEnv,
  parseIntBounded,
  defaultMonitoringPort: managerConfig.DEFAULT_MONITORING_PORT,
  defaultHealthPort: managerConfig.DEFAULT_HEALTH_PORT,
  managerLabel: managerConfig.MANAGER_LABEL,
  managedLabelValues: managerConfig.MANAGED_LABEL_VALUES,
  codeGatewayImage: managerConfig.codeGatewayImage,
  monitoringImage: managerConfig.monitoringImage,
  codexContainerName: managerConfig.codexContainerName,
  monitoringContainerName: managerConfig.monitoringContainerName,
  codexDataVolumeName: managerConfig.codexDataVolumeName,
  monitoringDataVolumeName: managerConfig.monitoringDataVolumeName,
  codexGatewayIndexPath: managerConfig.codexGatewayIndexPath,
  codexGatewayIndexHostPath: managerConfig.codexGatewayIndexHostPath,
  codexPublicHost: managerConfig.codexPublicHost,
  monitoringPublicHost: managerConfig.monitoringPublicHost,
  chooseCodexPort: managerConfig.chooseCodexPort,
  resolveManagedSecurityOpts: managerConfig.resolveManagedSecurityOpts,
  resolveEngineLabel: managerConfig.resolveEngineLabel,
  getExtraServices: managerConfig.getExtraServices,
  resolveCodexWorkspaceHostPath,
  resolveCodexGatewayIndexHostPath,
});

const STARTED_AT = new Date().toISOString();

registerRoutes({
  app,
  pkg,
  resolveEngineLabel: managerConfig.resolveEngineLabel,
  startedAt: STARTED_AT,
  requireAuth,
  getExtraServices: managerConfig.getExtraServices,
  sanitizeSegment,
  userKeyFromInput: managerConfig.userKeyFromInput,
  resolveManagedServiceDefinition: managedRuntime.resolveManagedServiceDefinition,
  buildStateForService: managedRuntime.buildStateForService,
  ensureManagedService: managedRuntime.ensureManagedService,
  allowedActions: managedRuntime.allowedActions,
  applyAction: managedRuntime.applyAction,
  parseQueryBool,
  asBool,
  managedLabelValues: managerConfig.MANAGED_LABEL_VALUES,
  docker,
  formatContainerSummary,
  inspectContainer: managedRuntime.inspectContainer,
  isManagedContainer: managedRuntime.isManagedContainer,
  parseIntBounded,
  containerFromName: managedRuntime.containerFromName,
  readDockerLogBuffer,
  demuxDockerLogs,
  parseEnvList,
  parseEnvMap,
  ensureImage: managedRuntime.ensureImage,
  resolveManagedSecurityOpts: managerConfig.resolveManagedSecurityOpts,
  managerLabel: managerConfig.MANAGER_LABEL,
  resolveAllowUnmanagedActions: managerConfig.resolveAllowUnmanagedActions,
});

app.use((error, _req, res, _next) => {
  const message = String(error?.message || error || 'Internal error');
  console.error(`[container-manager] ${message}`);
  if (res.headersSent) return;
  res.status(500).json({ error: message });
});

const host = String(pickEnv('CONTAINER_MANAGER_HOST', 'CONTAINER_AGENT_HOST') || '0.0.0.0').trim();
const port = parseIntBounded(
  pickEnv('CONTAINER_MANAGER_PORT', 'CONTAINER_AGENT_PORT'),
  4070,
  1,
  65535
);
const { server, protocol } = createServer();

server.listen(port, host, () => {
  console.log(
    `[container-manager] listening on ${protocol}://${host}:${port} (engine=${managerConfig.resolveEngineLabel()}, version=${pkg.version})`
  );
});
