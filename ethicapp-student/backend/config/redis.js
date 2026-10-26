// The application Redis holds Express sessions, cross-service domain events
// and other application state that must not be evicted as cache (#660).

/**
 * Application Redis URL from REDIS_APP_URL, or REDIS_APP_HOST and
 * REDIS_APP_PORT (default redis-app:6379).
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveApplicationRedisUrl(env = process.env) {
  const host = env.REDIS_APP_HOST || 'redis-app';
  const port = env.REDIS_APP_PORT || '6379';
  return env.REDIS_APP_URL || `redis://${host}:${port}`;
}
