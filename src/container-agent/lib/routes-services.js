const registerServiceRoutes = ({
  app,
  getExtraServices,
  sanitizeSegment,
  userKeyFromInput,
  resolveManagedServiceDefinition,
  buildStateForService,
  ensureManagedService,
  allowedActions,
  applyAction,
}) => {
  app.get('/v1/services', async (_req, res) => {
    const extras = getExtraServices();
    const services = [
      { key: 'codex-gateway', userScoped: true, managed: true },
      { key: 'monitoring', userScoped: false, managed: true },
      ...Object.keys(extras).map((key) => ({ key, userScoped: false, managed: true })),
    ];
    res.status(200).json({ ok: true, services });
  });

  app.get('/v1/services/:service/state', async (req, res, next) => {
    try {
      const serviceKey = sanitizeSegment(req.params.service, 64);
      const userKey = userKeyFromInput(req.query.userId || 'anonymous');
      const userName = String(req.query.userName || '').trim();
      const service = await resolveManagedServiceDefinition(serviceKey, userKey, userName, null);
      if (!service) {
        res.status(404).json({ error: `Unknown service: ${serviceKey}` });
        return;
      }
      const state = await buildStateForService(
        service,
        serviceKey === 'codex-gateway' ? userKey : null
      );
      res.status(200).json({ ok: true, state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/services/:service/ensure', async (req, res, next) => {
    try {
      const serviceKey = sanitizeSegment(req.params.service, 64);
      const userKey = userKeyFromInput(req.body?.userId || 'anonymous');
      const userName = String(req.body?.userName || '').trim();
      const preferredPort = req.body?.preferredPort;
      const service = await resolveManagedServiceDefinition(
        serviceKey,
        userKey,
        userName,
        preferredPort
      );
      if (!service) {
        res.status(404).json({ error: `Unknown service: ${serviceKey}` });
        return;
      }
      const state = await ensureManagedService(
        service,
        serviceKey === 'codex-gateway' ? userKey : null
      );
      res.status(200).json({ ok: true, state });
    } catch (error) {
      next(error);
    }
  });

  app.post('/v1/services/:service/action', async (req, res, next) => {
    try {
      const action = String(req.body?.action || '').trim().toLowerCase();
      if (!allowedActions.has(action)) {
        res.status(400).json({ error: 'Invalid action' });
        return;
      }
      const serviceKey = sanitizeSegment(req.params.service, 64);
      const userKey = userKeyFromInput(req.body?.userId || 'anonymous');
      const userName = String(req.body?.userName || '').trim();
      const preferredPort = req.body?.preferredPort;
      const service = await resolveManagedServiceDefinition(
        serviceKey,
        userKey,
        userName,
        preferredPort
      );
      if (!service) {
        res.status(404).json({ error: `Unknown service: ${serviceKey}` });
        return;
      }

      if (action === 'create') {
        const state = await ensureManagedService(
          service,
          serviceKey === 'codex-gateway' ? userKey : null
        );
        res.status(200).json({ ok: true, state });
        return;
      }

      await applyAction(service.containerName, action);
      const state = await buildStateForService(
        service,
        serviceKey === 'codex-gateway' ? userKey : null
      );
      res.status(200).json({ ok: true, state });
    } catch (error) {
      next(error);
    }
  });
};

module.exports = {
  registerServiceRoutes,
};
