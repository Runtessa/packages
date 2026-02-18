const pkg = require('../package.json');
const { requireAuth } = require('./utils');
const { ingestHandler } = require('./handlers/ingest');
const { summaryHandler } = require('./handlers/summary');
const { eventsHandler } = require('./handlers/events');
const { rulesListHandler, ruleByIdHandler } = require('./handlers/rules');

const withAuth = (handler) => async (req, res, next) => {
  if (!requireAuth(req, res)) return;
  try {
    await handler(req, res);
  } catch (error) {
    next(error);
  }
};

const registerRoutes = (app) => {
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'idp-monitoring-service',
      version: pkg.version,
      now: new Date().toISOString(),
    });
  });

  app.post('/ingest', withAuth(ingestHandler));
  app.post('/api/admin/monitoring/ingest', withAuth(ingestHandler));

  app.get('/api/admin/monitoring/summary', withAuth(summaryHandler));
  app.get('/api/admin/monitoring/events', withAuth(eventsHandler));
  app.get('/api/admin/monitoring/rules', withAuth(rulesListHandler));
  app.post('/api/admin/monitoring/rules', withAuth(rulesListHandler));
  app.put('/api/admin/monitoring/rules/:id', withAuth(ruleByIdHandler));
  app.delete('/api/admin/monitoring/rules/:id', withAuth(ruleByIdHandler));
};

module.exports = {
  registerRoutes,
};
