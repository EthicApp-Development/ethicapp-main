// The application Redis holds Express sessions, cross-service domain events
// and other application state that must not be evicted as cache (#660).
// REDIS_APP_* names it; REDIS_SESSION_* is the deprecated name, still read for
// one release so existing deployments keep working.

const DEFAULT_HOST = 'redis-app';
const DEFAULT_PORT = '6379';
const CURRENT = ['REDIS_APP_URL', 'REDIS_APP_HOST', 'REDIS_APP_PORT'];
const DEPRECATED = ['REDIS_SESSION_URL', 'REDIS_SESSION_HOST', 'REDIS_SESSION_PORT'];

const warnedProcesses = new WeakSet();

function urlFrom(env, [urlName, hostName, portName]) {
  const host = env[hostName] || DEFAULT_HOST;
  const port = env[portName] || DEFAULT_PORT;
  return env[urlName] || `redis://${host}:${port}`;
}

/**
 * Resolves the application Redis without side effects. When any REDIS_APP_*
 * variable is set, that group decides; otherwise REDIS_SESSION_* is used and
 * reported as deprecated.
 * @param {Record<string, string | undefined>} env
 * @returns {{ url: string, deprecatedVariables: string[] }}
 */
export function resolveApplicationRedis(env = process.env) {
  if (CURRENT.some((name) => env[name])) {
    return { url: urlFrom(env, CURRENT), deprecatedVariables: [] };
  }

  const deprecatedVariables = DEPRECATED.filter((name) => env[name]);

  if (deprecatedVariables.length > 0) {
    return { url: urlFrom(env, DEPRECATED), deprecatedVariables };
  }

  return { url: urlFrom(env, CURRENT), deprecatedVariables: [] };
}

/**
 * Application Redis URL; logs one deprecation warning per process when only
 * REDIS_SESSION_* is configured.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ warn: (message: string) => void }} [logger]
 * @param {object} [processKey] Identity used to warn once.
 */
export function resolveApplicationRedisUrl(env = process.env, logger = console, processKey = process) {
  const { url, deprecatedVariables } = resolveApplicationRedis(env);

  if (deprecatedVariables.length > 0 && !warnedProcesses.has(processKey)) {
    warnedProcesses.add(processKey);
    logger.warn(
      `[application-redis] Deprecated variables in use: ${deprecatedVariables.join(', ')}. ` +
      'Set the matching REDIS_APP_* variables; REDIS_SESSION_* will be removed in a later release.'
    );
  }

  return url;
}
