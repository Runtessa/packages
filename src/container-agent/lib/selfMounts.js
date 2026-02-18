const fs = require('fs');
const path = require('path');

const createSelfMountResolver = ({
  docker,
  pickEnv,
  codexWorkspaceRoot,
  codexGatewayIndexPath,
  codexGatewayIndexHostPath,
}) => {
  let cachedSelfMounts = null;
  let cachedSelfMountsAt = 0;
  const SELF_MOUNT_CACHE_MS = 10_000;

  const normalizeContainerPath = (value) => {
    const normalized = path.posix.normalize(`/${String(value || '').replace(/[\\]+/g, '/')}`);
    return normalized.replace(/\/+$/, '') || '/';
  };

  const resolveSelfContainerId = () => {
    const explicit = pickEnv(
      'CONTAINER_MANAGER_CONTAINER_ID',
      'CONTAINER_AGENT_CONTAINER_ID',
      'HOSTNAME'
    );
    if (explicit) return String(explicit).trim();
    try {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      const match = cgroup.match(/([0-9a-f]{12,64})(?:\.scope)?$/im);
      return match ? String(match[1]).trim() : '';
    } catch {
      return '';
    }
  };

  const getSelfMounts = async () => {
    const now = Date.now();
    if (cachedSelfMounts && now - cachedSelfMountsAt < SELF_MOUNT_CACHE_MS) {
      return cachedSelfMounts;
    }
    const containerId = resolveSelfContainerId();
    if (!containerId) {
      cachedSelfMounts = [];
      cachedSelfMountsAt = now;
      return cachedSelfMounts;
    }
    try {
      const inspect = await docker.getContainer(containerId).inspect();
      const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
      cachedSelfMounts = mounts
        .filter((mount) => mount?.Source && mount?.Destination)
        .map((mount) => ({
          source: String(mount.Source),
          destination: normalizeContainerPath(mount.Destination),
        }));
      cachedSelfMountsAt = now;
      return cachedSelfMounts;
    } catch {
      cachedSelfMounts = [];
      cachedSelfMountsAt = now;
      return cachedSelfMounts;
    }
  };

  const mapContainerPathToHostPath = async (containerPath) => {
    const mounts = await getSelfMounts();
    if (!mounts.length) return '';
    const normalizedTarget = normalizeContainerPath(containerPath);
    let bestMatch = null;
    for (const mount of mounts) {
      if (
        normalizedTarget === mount.destination ||
        normalizedTarget.startsWith(`${mount.destination}/`)
      ) {
        if (!bestMatch || mount.destination.length > bestMatch.destination.length) {
          bestMatch = mount;
        }
      }
    }
    if (!bestMatch) return '';
    const relative = path.posix.relative(bestMatch.destination, normalizedTarget);
    if (!relative || relative === '.') return bestMatch.source;
    return path.join(bestMatch.source, relative);
  };

  const resolveCodexWorkspaceHostPath = async () => {
    const explicit = pickEnv(
      'CONTAINER_MANAGER_WORKSPACE_HOST_PATH',
      'CONTAINER_AGENT_WORKSPACE_HOST_PATH'
    );
    if (explicit) return explicit;
    const mapped = await mapContainerPathToHostPath(codexWorkspaceRoot());
    if (mapped) return mapped;
    return codexWorkspaceRoot();
  };

  const resolveCodexGatewayIndexHostPath = async () => {
    const explicitHostPath = codexGatewayIndexHostPath();
    if (explicitHostPath) return explicitHostPath;
    const mapped = await mapContainerPathToHostPath(codexGatewayIndexPath());
    if (mapped) return mapped;
    return codexGatewayIndexPath();
  };

  return {
    resolveCodexWorkspaceHostPath,
    resolveCodexGatewayIndexHostPath,
  };
};

module.exports = {
  createSelfMountResolver,
};
