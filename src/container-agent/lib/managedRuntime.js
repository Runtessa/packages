const { createContainerLifecycle } = require('./containerLifecycle');
const { createManagedServiceDefinitionResolver } = require('./managedServiceDefinitions');

const createManagedRuntime = ({
  fs,
  docker,
  pickEnv,
  parseIntBounded,
  defaultMonitoringPort,
  defaultHealthPort,
  managerLabel,
  managedLabelValues,
  codeGatewayImage,
  monitoringImage,
  codexContainerName,
  monitoringContainerName,
  codexDataVolumeName,
  monitoringDataVolumeName,
  codexGatewayIndexPath,
  codexGatewayIndexHostPath,
  codexPublicHost,
  monitoringPublicHost,
  chooseCodexPort,
  resolveManagedSecurityOpts,
  resolveEngineLabel,
  getExtraServices,
  resolveCodexWorkspaceHostPath,
  resolveCodexGatewayIndexHostPath,
}) => {
  const lifecycle = createContainerLifecycle({
    docker,
    resolveManagedSecurityOpts,
  });

  const { resolveManagedServiceDefinition } = createManagedServiceDefinitionResolver({
    fs,
    pickEnv,
    parseIntBounded,
    defaultMonitoringPort,
    defaultHealthPort,
    codeGatewayImage,
    monitoringImage,
    codexContainerName,
    monitoringContainerName,
    codexDataVolumeName,
    monitoringDataVolumeName,
    codexGatewayIndexPath,
    codexGatewayIndexHostPath,
    codexPublicHost,
    monitoringPublicHost,
    chooseCodexPort,
    getExtraServices,
    resolveCodexWorkspaceHostPath,
    resolveCodexGatewayIndexHostPath,
  });

  const isManagedContainer = (inspect) => {
    const label = String(inspect?.Config?.Labels?.['idp.managed.by'] || '').trim();
    return managedLabelValues.includes(label);
  };

  const buildStateForService = async (serviceDefinition, userKey = null) => {
    const inspect = await lifecycle.inspectContainer(serviceDefinition.containerName);
    const running = Boolean(inspect?.State?.Running);
    const port = inspect
      ? lifecycle.extractMappedPort(inspect, serviceDefinition.containerPort) ??
        serviceDefinition.hostPort
      : serviceDefinition.hostPort;
    return {
      service: serviceDefinition.key,
      ...(userKey ? { userKey } : {}),
      containerName: serviceDefinition.containerName,
      engine: resolveEngineLabel(),
      image: serviceDefinition.image,
      exists: Boolean(inspect),
      running,
      port,
      host: serviceDefinition.publicHost,
      baseUrl: `${serviceDefinition.protocol}://${serviceDefinition.publicHost}:${port}`,
    };
  };

  const ensureManagedService = async (serviceDefinition, userKey = null) => {
    const labels = {
      'idp.managed.by': managerLabel,
      ...serviceDefinition.labels,
    };
    let inspect = await lifecycle.createContainerIfMissing({
      name: serviceDefinition.containerName,
      image: serviceDefinition.image,
      port: serviceDefinition.hostPort,
      binds: serviceDefinition.binds,
      env: serviceDefinition.env,
      labels,
      containerPort: serviceDefinition.containerPort,
    });
    inspect = await lifecycle.startContainerIfStopped(serviceDefinition.containerName, inspect);
    const port =
      lifecycle.extractMappedPort(inspect, serviceDefinition.containerPort) ??
      serviceDefinition.hostPort;
    return {
      service: serviceDefinition.key,
      ...(userKey ? { userKey } : {}),
      containerName: serviceDefinition.containerName,
      engine: resolveEngineLabel(),
      image: serviceDefinition.image,
      exists: true,
      running: Boolean(inspect?.State?.Running),
      port,
      host: serviceDefinition.publicHost,
      baseUrl: `${serviceDefinition.protocol}://${serviceDefinition.publicHost}:${port}`,
    };
  };

  return {
    allowedActions: new Set(['create', 'start', 'stop', 'restart', 'remove']),
    containerFromName: lifecycle.containerFromName,
    inspectContainer: lifecycle.inspectContainer,
    ensureImage: lifecycle.ensureImage,
    applyAction: lifecycle.applyAction,
    resolveManagedServiceDefinition,
    isManagedContainer,
    buildStateForService,
    ensureManagedService,
  };
};

module.exports = {
  createManagedRuntime,
};
