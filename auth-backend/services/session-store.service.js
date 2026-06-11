import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { getDefaultAuthSessionTtlSeconds } from '../middleware/sessionPolicy.js';

function createSessionRedisClient() {
  const host = process.env.REDIS_SESSION_HOST || 'redis-session';
  const port = process.env.REDIS_SESSION_PORT || '6379';
  const url = process.env.REDIS_SESSION_URL || `redis://${host}:${port}`;

  const client = createClient({ url });

  client.on('connect', () => {
    console.log('[auth-session] Connected to Redis.');
  });

  client.on('error', (error) => {
    console.error('[auth-session] Redis connection error:', error);
  });

  client.connect().catch((error) => {
    console.error('[auth-session] Redis connection could not be established:', error);
  });

  return client;
}

function createSessionStore() {
  return new RedisStore({
    client: createSessionRedisClient(),
    prefix: process.env.AUTH_SESSION_REDIS_PREFIX || 'auth:sess:',
    ttl: Number(process.env.AUTH_SESSION_TTL_SECONDS || getDefaultAuthSessionTtlSeconds())
  });
}

export { createSessionStore };
