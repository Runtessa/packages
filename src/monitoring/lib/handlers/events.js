const { readAlerts } = require('../redisStore');
const { toPage, toLimit, toNumber, str } = require('../utils');

const eventsHandler = async (req, res) => {
  const page = toPage(req.query.page);
  const limit = toLimit(req.query.limit, 25, 200);
  const minutes = Math.min(Math.max(toNumber(req.query.minutes, 60), 5), 24 * 60);
  const severity = str(req.query.severity).trim();
  const status = str(req.query.status).trim();
  const tenantId = str(req.query.tenantId).trim();
  const serverName = str(req.query.serverName).trim();
  const instanceId = str(req.query.instanceId).trim();
  const sinceTs = Date.now() - minutes * 60_000;

  const all = await readAlerts(5000);
  const filtered = all
    .filter((event) => {
      const ts = new Date(event.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < sinceTs) return false;
      if (severity && event.severity !== severity) return false;
      if (status && event.status !== status) return false;
      if (tenantId && event.tenantId !== tenantId) return false;
      if (serverName && event.serverName !== serverName) return false;
      if (instanceId && event.instanceId !== instanceId) return false;
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const total = filtered.length;
  const start = (page - 1) * limit;
  const events = filtered.slice(start, start + limit);
  res.status(200).json({ page, limit, total, events });
};

module.exports = { eventsHandler };
