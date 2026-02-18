const {
  DEFAULT_HEALTH_PORT,
  DEFAULT_CODEX_PORT_START,
  DEFAULT_CODEX_PORT_END,
  DEFAULT_MONITORING_PORT,
  MANAGER_LABEL,
  LEGACY_MANAGER_LABEL,
  MANAGED_LABEL_VALUES,
} = require('./configConstants');

const createManagerConfig = ({
  pickEnv,
  asBool,
  parseIntBounded,
  parseCsvList,
  sanitizeSegment,
  hashText,
  parseExtraServices,
}) => {
  const resolveEngineLabel = () => {
    const raw = String(
      pickEnv('CONTAINER_MANAGER_ENGINE_LABEL', 'CONTAINER_AGENT_ENGINE_LABEL') || 'docker'
    )
      .trim()
      .toLowerCase();
    return raw === 'podman' ? 'podman' : 'docker';
  };

  const resolveManagedSecurityOpts = () => {
    const explicit = parseCsvList(
      pickEnv('CONTAINER_MANAGER_SECURITY_OPTS', 'CONTAINER_AGENT_SECURITY_OPTS')
    );
    if (explicit.length > 0) return explicit;
    if (resolveEngineLabel() === 'podman') return ['label=disable'];
    return [];
  };

  const codeGatewayImage = () =>
    String(
      pickEnv('CONTAINER_MANAGER_CODEX_IMAGE', 'CONTAINER_AGENT_CODEX_IMAGE') ||
        'idp/codex-gateway:latest'
    ).trim();

  const monitoringImage = () =>
    String(
      pickEnv('CONTAINER_MANAGER_MONITORING_IMAGE', 'CONTAINER_AGENT_MONITORING_IMAGE') ||
        'idp-monitoring:latest'
    ).trim();

  const codexPrefix = () =>
    sanitizeSegment(
      pickEnv('CONTAINER_MANAGER_CODEX_CONTAINER_PREFIX', 'CONTAINER_AGENT_CODEX_CONTAINER_PREFIX') ||
        'idp-codex-gw',
      40
    ) || 'idp-codex-gw';

  const monitoringContainerName = () =>
    sanitizeSegment(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_CONTAINER_NAME',
        'CONTAINER_AGENT_MONITORING_CONTAINER_NAME'
      ) || 'idp-monitoring',
      64
    ) || 'idp-monitoring';

  const managerWorkspaceMountPath = () =>
    String(
      pickEnv(
        'CONTAINER_MANAGER_WORKSPACE_MOUNT_PATH',
        'CONTAINER_AGENT_WORKSPACE_MOUNT_PATH'
      ) || '/srv/idp'
    ).trim();

  const codexWorkspaceRoot = () =>
    String(
      pickEnv('CONTAINER_MANAGER_CODEX_WORKSPACE_ROOT', 'CONTAINER_AGENT_CODEX_WORKSPACE_ROOT') ||
        managerWorkspaceMountPath()
    ).trim();

  const codexDataVolumePrefix = () =>
    sanitizeSegment(
      pickEnv(
        'CONTAINER_MANAGER_CODEX_DATA_VOLUME_PREFIX',
        'CONTAINER_AGENT_CODEX_DATA_VOLUME_PREFIX'
      ) || `${codexPrefix()}-data`,
      48
    ) || `${codexPrefix()}-data`;

  const codexDataVolumeName = (userKey) => {
    const safeUser = sanitizeSegment(userKey || 'anonymous', 40) || 'anonymous';
    return `${codexDataVolumePrefix()}-${safeUser}`;
  };

  const monitoringDataVolumeName = () =>
    sanitizeSegment(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_DATA_VOLUME',
        'CONTAINER_AGENT_MONITORING_DATA_VOLUME'
      ) || 'idp-monitoring-data',
      64
    ) || 'idp-monitoring-data';

  const codexGatewayIndexPath = () =>
    String(
      pickEnv(
        'CONTAINER_MANAGER_CODEX_GATEWAY_INDEX_PATH',
        'CONTAINER_AGENT_CODEX_GATEWAY_INDEX_PATH'
      ) || `${codexWorkspaceRoot().replace(/[\\]+/g, '/')}/src/codex-gateway/index.js`
    ).trim();

  const codexGatewayIndexHostPath = () =>
    String(
      pickEnv(
        'CONTAINER_MANAGER_CODEX_GATEWAY_INDEX_HOST_PATH',
        'CONTAINER_AGENT_CODEX_GATEWAY_INDEX_HOST_PATH'
      )
    ).trim();

  const codexPublicHost = () =>
    String(
      pickEnv('CONTAINER_MANAGER_CODEX_PUBLIC_HOST', 'CONTAINER_AGENT_CODEX_PUBLIC_HOST') ||
        '127.0.0.1'
    ).trim() || '127.0.0.1';

  const monitoringPublicHost = () =>
    String(
      pickEnv(
        'CONTAINER_MANAGER_MONITORING_PUBLIC_HOST',
        'CONTAINER_AGENT_MONITORING_PUBLIC_HOST'
      ) || codexPublicHost()
    ).trim() || codexPublicHost();

  const getCodexPortRange = () => {
    const start = parseIntBounded(
      pickEnv('CONTAINER_MANAGER_CODEX_PORT_START', 'CONTAINER_AGENT_CODEX_PORT_START'),
      DEFAULT_CODEX_PORT_START,
      1024,
      65530
    );
    const end = parseIntBounded(
      pickEnv('CONTAINER_MANAGER_CODEX_PORT_END', 'CONTAINER_AGENT_CODEX_PORT_END'),
      DEFAULT_CODEX_PORT_END,
      start + 1,
      65535
    );
    return { start, end };
  };

  const chooseCodexPort = (userKey, preferredPort) => {
    const preferred = Number(preferredPort);
    if (Number.isFinite(preferred) && preferred > 0 && preferred < 65536) {
      return Math.floor(preferred);
    }
    const { start, end } = getCodexPortRange();
    const span = end - start + 1;
    return start + (hashText(userKey) % span);
  };

  const codexContainerName = (userKey, userName) => {
    const key = sanitizeSegment(userKey, 24) || 'anonymous';
    const name = sanitizeSegment(String(userName || '').toLowerCase(), 32);
    return name ? `${codexPrefix()}-${name}-${key}` : `${codexPrefix()}-${key}`;
  };

  const userKeyFromInput = (value) => sanitizeSegment(value || 'anonymous', 48) || 'anonymous';

  const getExtraServices = () =>
    parseExtraServices({
      pickEnv,
      sanitizeSegment,
      parseIntBounded,
      codexPublicHost,
    });

  const resolveAllowUnmanagedActions = () =>
    asBool(
      pickEnv(
        'CONTAINER_MANAGER_ALLOW_UNMANAGED_ACTIONS',
        'CONTAINER_AGENT_ALLOW_UNMANAGED_ACTIONS'
      ),
      true
    );

  return {
    DEFAULT_HEALTH_PORT,
    DEFAULT_MONITORING_PORT,
    MANAGER_LABEL,
    MANAGED_LABEL_VALUES,
    resolveEngineLabel,
    resolveManagedSecurityOpts,
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
    userKeyFromInput,
    getExtraServices,
    resolveAllowUnmanagedActions,
    codexWorkspaceRoot,
  };
};

module.exports = {
  createManagerConfig,
  DEFAULT_HEALTH_PORT,
  DEFAULT_CODEX_PORT_START,
  DEFAULT_CODEX_PORT_END,
  DEFAULT_MONITORING_PORT,
  MANAGER_LABEL,
  LEGACY_MANAGER_LABEL,
  MANAGED_LABEL_VALUES,
};
