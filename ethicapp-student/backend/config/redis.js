/**
 * URL of the application Redis shared by Express sessions and domain events.
 * The REDIS_SESSION_* names are kept until the rename to REDIS_APP_* (#660).
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolveApplicationRedisUrl(env = process.env) {
  const host = env.REDIS_SESSION_HOST || 'redis-session';
  const port = env.REDIS_SESSION_PORT || '6379';
  return env.REDIS_SESSION_URL || `redis://${host}:${port}`;
}
