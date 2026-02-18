const { registerServiceRoutes } = require('./routes-services');
const { registerContainerRoutes } = require('./routes-containers');

const registerRoutes = ({
  app,
  pkg,
  resolveEngineLabel,
  startedAt,
  requireAuth,
  ...deps
}) => {
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'idp-container-manager',
      version: pkg.version,
      engine: resolveEngineLabel(),
      now: new Date().toISOString(),
    });
  });

  app.get('/api/version', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'idp-container-manager',
      version: pkg.version,
      startedAt,
      now: new Date().toISOString(),
    });
  });

  app.use('/v1', requireAuth);
  registerServiceRoutes({ app, ...deps });
  registerContainerRoutes({ app, ...deps });
};

module.exports = {
  registerRoutes,
};
