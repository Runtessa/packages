const createContainerLifecycle = ({ docker, resolveManagedSecurityOpts }) => {
  const containerFromName = (name) => docker.getContainer(name);

  const inspectContainer = async (name) => {
    try {
      return await containerFromName(name).inspect();
    } catch (error) {
      if (error?.statusCode === 404) return null;
      throw error;
    }
  };

  const ensureImage = async (image) => {
    try {
      await docker.getImage(image).inspect();
      return;
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
    }

    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        docker.modem.followProgress(stream, (pullErr) => {
          if (pullErr) reject(pullErr);
          else resolve(undefined);
        });
      });
    });
  };

  const extractMappedPort = (inspect, containerPort) => {
    const key = `${containerPort}/tcp`;
    const mapping = inspect?.NetworkSettings?.Ports?.[key];
    if (!Array.isArray(mapping) || !mapping[0]?.HostPort) return null;
    const port = Number(mapping[0].HostPort);
    if (!Number.isFinite(port)) return null;
    return port;
  };

  const createContainerIfMissing = async ({
    name,
    image,
    port,
    binds,
    env,
    labels,
    containerPort,
  }) => {
    const existing = await inspectContainer(name);
    if (existing) return existing;

    await ensureImage(image);

    const securityOpts = resolveManagedSecurityOpts();
    const container = await docker.createContainer({
      name,
      Image: image,
      Env: env,
      Labels: labels,
      ExposedPorts: {
        [`${containerPort}/tcp`]: {},
      },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        PortBindings: {
          [`${containerPort}/tcp`]: [{ HostPort: String(port) }],
        },
        Binds: binds,
        ...(securityOpts.length > 0 ? { SecurityOpt: securityOpts } : {}),
      },
    });
    await container.start();
    return inspectContainer(name);
  };

  const startContainerIfStopped = async (name, inspect) => {
    if (inspect?.State?.Running) return inspect;
    await containerFromName(name).start();
    return inspectContainer(name);
  };

  const applyAction = async (name, action) => {
    const inspect = await inspectContainer(name);
    if (!inspect) {
      if (action === 'remove') return;
      throw new Error(`Container ${name} does not exist`);
    }
    const container = containerFromName(name);
    if (action === 'start') {
      if (!inspect.State?.Running) await container.start();
      return;
    }
    if (action === 'stop') {
      if (inspect.State?.Running) await container.stop();
      return;
    }
    if (action === 'restart') {
      await container.restart();
      return;
    }
    if (action === 'remove') {
      await container.remove({ force: true });
      return;
    }
    throw new Error(`Unsupported action: ${action}`);
  };

  return {
    containerFromName,
    inspectContainer,
    ensureImage,
    extractMappedPort,
    createContainerIfMissing,
    startContainerIfStopped,
    applyAction,
  };
};

module.exports = {
  createContainerLifecycle,
};
