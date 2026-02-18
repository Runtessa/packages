const crypto = require('crypto');

const resolveToken = (pickEnv) => pickEnv('CONTAINER_MANAGER_TOKEN', 'CONTAINER_AGENT_TOKEN');

const timingSafeEqual = (left, right) => {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const extractBearer = (header) => {
  if (!header || typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const requireAuthFactory = ({ pickEnv }) => (req, res, next) => {
  const token = resolveToken(pickEnv);
  if (!token) {
    res.status(503).json({ error: 'CONTAINER_MANAGER_TOKEN is required' });
    return;
  }
  const provided = extractBearer(req.headers.authorization);
  if (!provided || !timingSafeEqual(provided, token)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

module.exports = {
  resolveToken,
  timingSafeEqual,
  extractBearer,
  requireAuthFactory,
};
