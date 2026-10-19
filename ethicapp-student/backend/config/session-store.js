import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import { resolveApplicationRedisUrl } from './redis.js';

const DEFAULT_PREFIX = 'ethicapp-student:sess:';
// Matches the student idle timeout enforced by auth-backend
// (AUTH_SESSION_STUDENT_IDLE_TIMEOUT_MS, 24 h).
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
// Per store operation. A request reads and then writes the session, so a
// stalled Redis adds at most about twice this value.
const DEFAULT_OPERATION_TIMEOUT_MS = 250;

/**
 * Lifetime of a student-app session. connect-redis derives the Redis TTL from
 * the cookie expiry, so the cookie maxAge and the store TTL must both use it.
 * @param {Record<string, string | undefined>} [env]
 * @returns {number} Seconds.
 */
export function resolveStudentSessionTtlSeconds(env = process.env) {
  const ttl = Number(env.ETHICAPP_STUDENT_SESSION_TTL_SECONDS);
  return Number.isInteger(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;
}

/**
 * Session store that never fails a request because of Redis.
 *
 * Identity in ethicapp-student comes from the X-User-Id / X-User-Role headers
 * set by NGINX and is rebuilt into the session on every request
 * (hydrateLegacySession), so the stored session holds nothing that cannot be
 * recovered. When the inner store errors or does not answer within
 * `timeoutMs`, reads behave as "no stored session" and writes are dropped.
 *
 * It deliberately never emits `disconnect`: express-session would then skip
 * creating req.session and every route would respond 401.
 */
export class ResilientSessionStore extends session.Store {
  constructor({ store, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, logger = console }) {
    super();
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.degraded = false;
  }

  get(sid, callback) {
    this.run('get', callback, null, (done) => this.store.get(sid, done));
  }

  set(sid, sess, callback) {
    this.run('set', callback, undefined, (done) => this.store.set(sid, sess, done));
  }

  touch(sid, sess, callback) {
    this.run('touch', callback, undefined, (done) => this.store.touch(sid, sess, done));
  }

  destroy(sid, callback) {
    this.run('destroy', callback, undefined, (done) => this.store.destroy(sid, done));
  }

  run(operation, callback, fallbackValue, invoke) {
    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (error) {
        this.markDegraded(operation, error);
        callback?.(null, fallbackValue);
        return;
      }

      this.markHealthy();
      callback?.(null, value);
    };

    const timer = setTimeout(
      () => finish(new Error(`timed out after ${this.timeoutMs} ms`)),
      this.timeoutMs
    );
    timer.unref?.();

    try {
      invoke(finish);
    } catch (error) {
      finish(error);
    }
  }

  markDegraded(operation, error) {
    if (!this.degraded) {
      this.degraded = true;
      this.logger.error(
        `[student-session] Redis session store unavailable (${operation}: ${error.message}); ` +
        'serving requests with header-derived sessions until it recovers.'
      );
    }
  }

  markHealthy() {
    if (this.degraded) {
      this.degraded = false;
      this.logger.log('[student-session] Redis session store recovered.');
    }
  }
}

/**
 * Builds the ethicapp-student session store on the application Redis.
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {typeof createClient} [options.createRedisClient] Injectable for tests.
 * @param {number} [options.timeoutMs]
 * @param {Console} [options.logger]
 * @returns {ResilientSessionStore}
 */
export function createStudentSessionStore({
  env = process.env,
  createRedisClient = createClient,
  timeoutMs,
  logger = console
} = {}) {
  const client = createRedisClient({
    url: resolveApplicationRedisUrl(env),
    // Fail fast while disconnected instead of queueing session commands.
    disableOfflineQueue: true
  });

  client.on('ready', () => {
    logger.log('[student-session] Connected to Redis.');
  });

  client.on('error', (error) => {
    logger.error('[student-session] Redis connection error:', error.message);
  });

  client.connect().catch((error) => {
    logger.error('[student-session] Redis connection could not be established:', error.message);
  });

  return new ResilientSessionStore({
    store: new RedisStore({
      client,
      prefix: env.ETHICAPP_STUDENT_SESSION_REDIS_PREFIX || DEFAULT_PREFIX,
      ttl: resolveStudentSessionTtlSeconds(env)
    }),
    timeoutMs,
    logger
  });
}
