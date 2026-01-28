import Redis from 'ioredis';

const redisUrl =
  process.env.CACHE_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

export default redis;
