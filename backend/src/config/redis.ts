import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('error', (err) => {
  console.error('Redis error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});

// Separate connection for BullMQ (requires maxRetriesPerRequest: null)
export function createRedisConnection(): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}
