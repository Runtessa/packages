const registerContainerWriteRoutes = ({
  app,
  sanitizeSegment,
  inspectContainer,
  parseEnvList,
  parseEnvMap,
  parseIntBounded,
  allowedActions,
  managerLabel,
  ensureImage,
  resolveManagedSecurityOpts,
  docker,
  resolveAllowUnmanagedActions,
  isManagedContainer,
  applyAction,
}) => {
  app.post('/v1/containers/create', async (req, res, next) => {
    try {
      const image = String(req.body?.image || '').trim();
      if (!image) {
        res.status(400).json({ error: 'image is required' });
        return;
      }

      const requestedName = sanitizeSegment(req.body?.name || '', 128);
      const containerName =
        requestedName ||
        `idp-${sanitizeSegment(image.replace(/[:/@]+/g, '-'), 40) || 'container'}-${Date.now()}`;
      const existing = await inspectContainer(containerName);
      if (existing) {
        res.status(409).json({ error: `Container ${containerName} already exists` });
        return;
      }

      const envList = parseEnvList(req.body?.env);
      const envMap = parseEnvMap(req.body?.envMap);
      const env = [
        ...envList,
        ...Object.entries(envMap).map(([key, value]) => `${key}=${value}`),
      ];
      const binds = parseEnvList(req.body?.binds);
      const labels = parseEnvMap(req.body?.labels);
      const managed = Boolean(req.body?.managed);
      if (managed) {
        labels['idp.managed.by'] = managerLabel;
      }

      const rawPorts = Array.isArray(req.body?.ports) ? req.body.ports : [];
      const ExposedPorts = {};
      const PortBindings = {};
      rawPorts.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const containerPort = parseIntBounded(entry.containerPort, 0, 1, 65535);
        if (!containerPort) return;
        const hostPort = parseIntBounded(entry.hostPort, 0, 0, 65535);
        const protocol =
          String(entry.protocol || 'tcp').trim().toLowerCase() === 'udp' ? 'udp' : 'tcp';
        const portKey = `${containerPort}/${protocol}`;
        ExposedPorts[portKey] = {};
        PortBindings[portKey] = hostPort > 0 ? [{ HostPort: String(hostPort) }] : [{}];
      });

      const restartPolicyName = String(req.body?.restartPolicy || 'unless-stopped')
        .trim()
        .toLowerCase();
      const allowedRestartPolicies = new Set([
        'no',
        'always',
        'unless-stopped',
        'on-failure',
      ]);
      const restartPolicy = allowedRestartPolicies.has(restartPolicyName)
        ? restartPolicyName
        : 'unless-stopped';

      const cmd =
        Array.isArray(req.body?.cmd) && req.body.cmd.length
          ? req.body.cmd.map((item) => String(item))
          : typeof req.body?.cmd === 'string' && req.body.cmd.trim()
          ? req.body.cmd
              .trim()
              .split(' ')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined;
      const entrypoint =
        Array.isArray(req.body?.entrypoint) && req.body.entrypoint.length
          ? req.body.entrypoint.map((item) => String(item))
          : typeof req.body?.entrypoint === 'string' && req.body.entrypoint.trim()
          ? req.body.entrypoint
              .trim()
              .split(' ')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined;

      await ensureImage(image);
      const securityOpts = resolveManagedSecurityOpts();
      const container = await docker.createContainer({
        name: containerName,
        Image: image,
        ...(env.length ? { Env: env } : {}),
        ...(Object.keys(labels).length ? { Labels: labels } : {}),
        ...(cmd && cmd.length ? { Cmd: cmd } : {}),
        ...(entrypoint && entrypoint.length ? { Entrypoint: entrypoint } : {}),
        ...(Object.keys(ExposedPorts).length ? { ExposedPorts } : {}),
        HostConfig: {
          RestartPolicy: { Name: restartPolicy },
          ...(Object.keys(PortBindings).length ? { PortBindings } : {}),
          ...(binds.length ? { Binds: binds } : {}),
          ...(securityOpts.length > 0 ? { SecurityOpt: securityOpts } : {}),
        },
      });

      const autoStart =
        req.body?.autoStart === undefined ? true : Boolean(req.body?.autoStart);
      if (autoStart) {
        await container.start();
      }

      const created = await inspectContainer(containerName);
      res.status(201).json({
        ok: true,
        containerName,
        created: true,
        running: Boolean(created?.State?.Running),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/containers/action', async (req, res, next) => {
    try {
      const action = String(req.body?.action || '').trim().toLowerCase();
      const containerName = sanitizeSegment(req.body?.containerName || '', 128);
      if (!allowedActions.has(action)) {
        res.status(400).json({ error: 'Invalid action' });
        return;
      }
      if (!containerName) {
        res.status(400).json({ error: 'containerName is required' });
        return;
      }
      const inspect = await inspectContainer(containerName);
      if (!inspect) {
        if (action === 'remove') {
          res.status(200).json({ ok: true, removed: true, containerName, existed: false });
          return;
        }
        res.status(404).json({ error: `Container ${containerName} not found` });
        return;
      }

      const allowUnmanaged = resolveAllowUnmanagedActions();
      if (!allowUnmanaged && !isManagedContainer(inspect)) {
        res.status(403).json({
          error:
            'Action denied for unmanaged container. Set CONTAINER_MANAGER_ALLOW_UNMANAGED_ACTIONS=true to override.',
        });
        return;
      }

      await applyAction(containerName, action);
      const nextState = await inspectContainer(containerName);
      res.status(200).json({
        ok: true,
        containerName,
        action,
        exists: Boolean(nextState),
        running: Boolean(nextState?.State?.Running),
      });
    } catch (error) {
      next(error);
    }
  });
};

module.exports = {
  registerContainerWriteRoutes,
};
