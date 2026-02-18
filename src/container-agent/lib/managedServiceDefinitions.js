const createManagedServiceDefinitionResolver = ({
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
}) => {
  const ensureCodexConfig = async (userKey, userName, preferredPort) => {
    const workspaceRoot = await resolveCodexWorkspaceHostPath();
    const image = codeGatewayImage();
    const port = chooseCodexPort(userKey, preferredPort);
    const name = codexContainerName(userKey, userName);
    const dataVolume = codexDataVolumeName(userKey);
    const binds = [`${workspaceRoot}:/workspace`, `${dataVolume}:/data`];
    const gatewayIndexInsideManager = codexGatewayIndexPath();
    if (gatewayIndexInsideManager && fs.existsSync(gatewayIndexInsideManager)) {
      const gatewayIndexHostPath = await resolveCodexGatewayIndexHostPath();
      if (gatewayIndexHostPath) {
        binds.push(`${gatewayIndexHostPath}:/app/index.js:ro`);
      }
    } else {
      const explicitGatewayIndexHostPath = codexGatewayIndexHostPath();
      if (explicitGatewayIndexHostPath) {
        binds.push(`${explicitGatewayIndexHostPath}:/app/index.js:ro`);
      }
    }
    return {
      name,
      image,
      port,
      binds,
      env: [
        `PORT=${defaultHealthPort}`,
        'WORKSPACE_ROOT=/workspace',
        'CODEX_GATEWAY_HISTORY_FILE=/data/history.json',
        'CODEX_GATEWAY_PROFILES_DIR=/data/profiles',
      ],
    };
  };

  const ensureMonitoringConfig = async () => {
    const image = monitoringImage();
    const containerName = monitoringContainerName();
    const port = parseIntBounded(
      pickEnv('CONTAINER_MANAGER_MONITORING_PORT', 'CONTAINER_AGENT_MONITORING_PORT'),
      defaultMonitoringPort,
      1,
      65535
    );
    const dataVolume = monitoringDataVolumeName();
    const env = [
      `MONITORING_PORT=${defaultMonitoringPort}`,
      `REDIS_URL=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_REDIS_URL',
          'CONTAINER_AGENT_MONITORING_REDIS_URL',
          'REDIS_URL'
        ) || 'redis://localhost:6379'
      ).trim()}`,
      `MONITORING_INGEST_TOKEN=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_INGEST_TOKEN',
          'CONTAINER_AGENT_MONITORING_INGEST_TOKEN',
          'MONITORING_INGEST_TOKEN'
        )
      ).trim()}`,
      `MONITORING_TLS_REQUIRED=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_TLS_REQUIRED',
          'CONTAINER_AGENT_MONITORING_TLS_REQUIRED'
        ) || 'true'
      ).trim()}`,
      `MONITORING_TLS_ENABLED=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_TLS_ENABLED',
          'CONTAINER_AGENT_MONITORING_TLS_ENABLED'
        ) || 'true'
      ).trim()}`,
      `MONITORING_TLS_AUTO_SELF_SIGNED=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_TLS_AUTO_SELF_SIGNED',
          'CONTAINER_AGENT_MONITORING_TLS_AUTO_SELF_SIGNED'
        ) || 'true'
      ).trim()}`,
      `MONITORING_TLS_KEY_PATH=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_TLS_KEY_PATH',
          'CONTAINER_AGENT_MONITORING_TLS_KEY_PATH'
        ) || '/app/certs/server.key'
      ).trim()}`,
      `MONITORING_TLS_CERT_PATH=${String(
        pickEnv(
          'CONTAINER_MANAGER_MONITORING_TLS_CERT_PATH',
          'CONTAINER_AGENT_MONITORING_TLS_CERT_PATH'
        ) || '/app/certs/server.crt'
      ).trim()}`,
    ];
    return {
      name: containerName,
      image,
      port,
      binds: [`${dataVolume}:/app/certs`],
      env,
    };
  };

  const resolveManagedServiceDefinition = async (serviceKey, userKey, userName, preferredPort) => {
    if (serviceKey === 'codex-gateway') {
      const config = await ensureCodexConfig(userKey || 'anonymous', userName || '', preferredPort);
      return {
        key: serviceKey,
        containerName: config.name,
        image: config.image,
        containerPort: defaultHealthPort,
        hostPort: config.port,
        protocol: 'http',
        publicHost: codexPublicHost(),
        env: config.env,
        binds: config.binds,
        labels: {
          'idp.service': 'codex-gateway',
          ...(userKey ? { 'idp.user': userKey } : {}),
        },
      };
    }

    if (serviceKey === 'monitoring') {
      const config = await ensureMonitoringConfig();
      return {
        key: serviceKey,
        containerName: config.name,
        image: config.image,
        containerPort: defaultMonitoringPort,
        hostPort: config.port,
        protocol: 'https',
        publicHost: monitoringPublicHost(),
        env: config.env,
        binds: config.binds,
        labels: {
          'idp.service': 'monitoring',
        },
      };
    }

    const extras = getExtraServices();
    const extra = extras[serviceKey];
    if (!extra) return null;
    return {
      key: extra.key,
      containerName: extra.containerName,
      image: extra.image,
      containerPort: extra.containerPort,
      hostPort: extra.hostPort,
      protocol: extra.protocol,
      publicHost: extra.publicHost,
      env: extra.env,
      binds: extra.binds,
      labels: {
        'idp.service': serviceKey,
        ...extra.labels,
      },
    };
  };

  return {
    resolveManagedServiceDefinition,
  };
};

module.exports = {
  createManagedServiceDefinitionResolver,
};
