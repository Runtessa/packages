const Redis = require('ioredis');
const { randomUUID } = require('crypto');
const { KEY } = require('./constants');
const { parseJson } = require('./utils');
const { isValidSnapshot, isValidAlert, normalizeSnapshot, normalizeAlert } = require('./models');

const redisUrl = process.env.CACHE_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  console.error(`[monitoring] redis error: ${err.message}`);
});

const ingestSnapshot = async (snapshot, retention, ttlSec) => {
  const instanceKey = `${snapshot.serverName}::${snapshot.instanceId}`;
  await redis
    .multi()
    .sadd(KEY.instances, instanceKey)
    .set(
      KEY.meta(instanceKey),
      JSON.stringify({
        serverName: snapshot.serverName,
        instanceId: snapshot.instanceId,
        instanceName: snapshot.instanceName,
        updatedAt: snapshot.createdAt,
      }),
    )
    .set(KEY.heartbeat(instanceKey), String(Date.now()), 'EX', ttlSec)
    .lpush(KEY.snapshots(instanceKey), JSON.stringify(snapshot))
    .ltrim(KEY.snapshots(instanceKey), 0, Math.max(retention - 1, 0))
    .exec();
};

const ingestAlert = async (alert, retention) => {
  await redis.multi().lpush(KEY.alerts, JSON.stringify(alert)).ltrim(KEY.alerts, 0, Math.max(retention - 1, 0)).exec();
};

const listInstanceKeys = async () => {
  const keys = await redis.smembers(KEY.instances);
  if (!keys.length) return [];

  const pipeline = redis.pipeline();
  keys.forEach((key) => pipeline.exists(KEY.heartbeat(key)));
  const result = await pipeline.exec();

  const activeKeys = [];
  const staleKeys = [];
  result?.forEach((entry, idx) => {
    const raw = entry?.[1];
    const exists = Number(raw) > 0;
    const key = keys[idx];
    if (!key) return;
    if (exists) activeKeys.push(key);
    else staleKeys.push(key);
  });

  if (staleKeys.length) {
    await redis.srem(KEY.instances, ...staleKeys);
  }

  return activeKeys;
};

const readSnapshots = async (instanceKey, limit) => {
  const raw = await redis.lrange(KEY.snapshots(instanceKey), 0, Math.max(limit - 1, 0));
  return raw.map((item) => parseJson(item)).filter((item) => isValidSnapshot(item)).map((item) => normalizeSnapshot(item));
};

const readAlerts = async (limit = 5000) => {
  const raw = await redis.lrange(KEY.alerts, 0, Math.max(limit - 1, 0));
  return raw.map((item) => parseJson(item)).filter((item) => isValidAlert(item)).map((item) => normalizeAlert(item));
};

const readRules = async () => {
  const ids = await redis.smembers(KEY.rulesIds);
  if (!ids.length) return [];

  const pipe = redis.pipeline();
  ids.forEach((id) => pipe.hget(KEY.rulesData, id));
  const result = await pipe.exec();

  const rules = [];
  result?.forEach((entry, idx) => {
    if (!entry || entry[0]) return;
    const parsed = parseJson(entry[1]);
    if (parsed?.id) rules.push(parsed);
    else if (ids[idx]) void redis.hdel(KEY.rulesData, ids[idx]);
  });

  return rules;
};

const createRule = async (input) => {
  const now = new Date().toISOString();
  const rule = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };

  await redis.multi().sadd(KEY.rulesIds, rule.id).hset(KEY.rulesData, rule.id, JSON.stringify(rule)).exec();
  return rule;
};

const updateRule = async (id, input) => {
  const existingRaw = await redis.hget(KEY.rulesData, id);
  const existing = parseJson(existingRaw);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...input,
    id,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await redis.multi().sadd(KEY.rulesIds, id).hset(KEY.rulesData, id, JSON.stringify(updated)).exec();
  return updated;
};

const deleteRule = async (id) => {
  const exists = await redis.hexists(KEY.rulesData, id);
  if (!exists) return false;
  await redis.multi().hdel(KEY.rulesData, id).srem(KEY.rulesIds, id).exec();
  return true;
};

module.exports = {
  redis,
  ingestSnapshot,
  ingestAlert,
  listInstanceKeys,
  readSnapshots,
  readAlerts,
  readRules,
  createRule,
  updateRule,
  deleteRule,
};
