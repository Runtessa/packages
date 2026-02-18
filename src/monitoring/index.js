const express = require('express');
const pkg = require('./package.json');
const { parseIntBounded } = require('./lib/utils');
const { createIngressServer } = require('./lib/tls');
const { registerRoutes } = require('./lib/routes');
const { registerErrorHandler } = require('./lib/errorHandler');

const app = express();
app.use(express.json({ limit: process.env.MONITORING_PAYLOAD_LIMIT || '2mb' }));

registerRoutes(app);
registerErrorHandler(app);

const host = (process.env.MONITORING_HOST || '0.0.0.0').trim();
const port = parseIntBounded(process.env.MONITORING_PORT, 3011, 1, 65535);
const { server, protocol } = createIngressServer(app);

server.listen(port, host, () => {
  console.log(`[monitoring] listening on ${protocol}://${host}:${port} (version: ${pkg.version})`);
});
