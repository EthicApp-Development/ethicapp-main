import { createClient } from 'redis';
import RedisStore from 'connect-redis';
import { getDefaultAuthSessionTtlSeconds } from '../middleware/sessionPolicy.js';
import { resolveApplicationRedisUrl } from './application-redis.js';

// Auth sessions live on the application Redis (REDIS_APP_*).
function createSessionRedisClient() {
  const client = createClient({ url: resolveApplicationRedisUrl() });

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
