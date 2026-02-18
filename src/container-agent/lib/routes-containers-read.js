const registerContainerReadRoutes = ({
  app,
  parseQueryBool,
  asBool,
  managedLabelValues,
  docker,
  formatContainerSummary,
  sanitizeSegment,
  inspectContainer,
  isManagedContainer,
  parseIntBounded,
  containerFromName,
  readDockerLogBuffer,
  demuxDockerLogs,
}) => {
  app.get('/v1/containers/list', async (req, res, next) => {
    try {
      const managedOnly = parseQueryBool(req.query.managedOnly, true, asBool);
      const query = {
        all: true,
        ...(managedOnly
          ? {
              filters: {
                label: managedLabelValues.map((value) => `idp.managed.by=${value}`),
              },
            }
          : {}),
      };
      const list = await docker.listContainers(query);
      const serviceFilter = String(req.query.service || '').trim();
      const search = String(req.query.search || '').trim().toLowerCase();
      const filtered = list.filter((row) => {
        if (serviceFilter) {
          const service = String(row.Labels?.['idp.service'] || '').trim();
          if (service !== serviceFilter) return false;
        }
        if (!search) return true;
        const haystack = [
          row.Id,
          ...(Array.isArray(row.Names) ? row.Names : []),
          row.Image,
          row.Command,
          row.Status,
          row.Labels?.['idp.service'] || '',
        ]
          .map((entry) => String(entry || '').toLowerCase())
          .join(' ');
        return haystack.includes(search);
      });

      res.status(200).json({
        ok: true,
        managedOnly,
        total: filtered.length,
        containers: filtered.map(formatContainerSummary),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/containers/:containerName/inspect', async (req, res, next) => {
    try {
      const containerName = sanitizeSegment(req.params.containerName || '', 128);
      if (!containerName) {
        res.status(400).json({ error: 'containerName is required' });
        return;
      }
      const inspect = await inspectContainer(containerName);
      if (!inspect) {
        res.status(404).json({ error: `Container ${containerName} not found` });
        return;
      }
      const state = {
        id: inspect.Id,
        name: String(inspect.Name || '').replace(/^\/+/, ''),
        image: inspect.Config?.Image || '',
        created: inspect.Created,
        platform: inspect.Platform || '',
        state: inspect.State || {},
        config: {
          env: inspect.Config?.Env || [],
          cmd: inspect.Config?.Cmd || [],
          entrypoint: inspect.Config?.Entrypoint || [],
          workingDir: inspect.Config?.WorkingDir || '',
          labels: inspect.Config?.Labels || {},
        },
        hostConfig: {
          restartPolicy: inspect.HostConfig?.RestartPolicy || {},
          networkMode: inspect.HostConfig?.NetworkMode || '',
          binds: inspect.HostConfig?.Binds || [],
          portBindings: inspect.HostConfig?.PortBindings || {},
        },
        mounts: inspect.Mounts || [],
        networkSettings: inspect.NetworkSettings || {},
        isManaged: isManagedContainer(inspect),
      };
      res.status(200).json({
        ok: true,
        containerName,
        inspect: state,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/containers/:containerName/logs', async (req, res, next) => {
    try {
      const containerName = sanitizeSegment(req.params.containerName || '', 128);
      if (!containerName) {
        res.status(400).json({ error: 'containerName is required' });
        return;
      }
      const inspect = await inspectContainer(containerName);
      if (!inspect) {
        res.status(404).json({ error: `Container ${containerName} not found` });
        return;
      }
      const tail = parseIntBounded(req.query.tail, 200, 1, 5000);
      const since = parseIntBounded(req.query.since, 0, 0, 4_000_000_000);
      const rawLogs = await containerFromName(containerName).logs({
        stdout: true,
        stderr: true,
        timestamps: true,
        tail,
        ...(since > 0 ? { since } : {}),
      });
      const logBuffer = await readDockerLogBuffer(rawLogs);
      const logs = demuxDockerLogs(logBuffer);
      res.status(200).json({
        ok: true,
        containerName,
        tail,
        logs,
      });
    } catch (error) {
      next(error);
    }
  });
};

module.exports = {
  registerContainerReadRoutes,
};
