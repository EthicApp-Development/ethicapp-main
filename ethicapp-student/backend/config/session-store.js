import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import { resolveApplicationRedisUrl } from './redis.js';
import { createConnectionResetter } from './redis-connection.js';

const DEFAULT_PREFIX = 'ethicapp-student:sess:';
// Matches the student idle timeout enforced by auth-backend
// (AUTH_SESSION_STUDENT_IDLE_TIMEOUT_MS, 24 h).
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
// Per store operation. A request reads and then writes the session, so a
// stalled Redis adds at most about twice this value.
const DEFAULT_OPERATION_TIMEOUT_MS = 250;
// After a failure, operations skip Redis for this long before one probe is let
// through, so a degraded Redis receives no traffic beyond that probe.
const DEFAULT_COOLDOWN_MS = 5000;
// Hard cap on commands queued or awaiting a reply on the session connection.
// Beyond it node-redis rejects new commands immediately ("The queue is full").
const DEFAULT_MAX_PENDING_COMMANDS = 100;

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
 * A failure also opens a circuit: for `cooldownMs` operations return the
 * fallback without reaching the inner store, then a single probe is let
 * through and its outcome closes or reopens the circuit. A timeout
 * additionally calls `onTimeout`, which lets the owner of the connection
 * release the operations still waiting on it (see createStudentSessionStore).
 * Together they keep the work retained by a stalled Redis bounded, not just
 * request latency.
 *
 * It deliberately never emits `disconnect`: express-session would then skip
 * creating req.session and every route would respond 401.
 */
export class ResilientSessionStore extends session.Store {
  constructor({
    store,
    timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    onTimeout = () => {},
    logger = console,
    now = Date.now
  }) {
    super();
    this.store = store;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.onTimeout = onTimeout;
    this.logger = logger;
    this.now = now;
    this.degraded = false;
    this.retryAt = 0;
    this.probeInFlight = false;
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
    let isProbe = false;
    if (this.degraded) {
      if (this.probeInFlight || this.now() < this.retryAt) {
        setImmediate(() => callback?.(null, fallbackValue));
        return;
      }
      this.probeInFlight = true;
      isProbe = true;
    }

    let settled = false;

    const finish = (error, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (isProbe) {
        this.probeInFlight = false;
      }

      if (error) {
        this.markDegraded(operation, error);
        callback?.(null, fallbackValue);
        return;
      }

      this.markHealthy();
      callback?.(null, value);
    };

    const timer = setTimeout(() => {
      finish(new Error(`timed out after ${this.timeoutMs} ms`));
      this.notifyTimeout();
    }, this.timeoutMs);

    try {
      invoke(finish);
    } catch (error) {
      finish(error);
    }
  }

  notifyTimeout() {
    try {
      Promise.resolve(this.onTimeout()).catch((error) => {
        this.logger.error('[student-session] Releasing timed-out Redis operations failed:', error.message);
      });
    } catch (error) {
      this.logger.error('[student-session] Releasing timed-out Redis operations failed:', error.message);
    }
  }

  markDegraded(operation, error) {
    this.retryAt = this.now() + this.cooldownMs;
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
 * @param {number} [options.cooldownMs]
 * @param {number} [options.maxPendingCommands]
 * @param {Console} [options.logger]
 * @returns {ResilientSessionStore}
 */
export function createStudentSessionStore({
  env = process.env,
  createRedisClient = createClient,
  timeoutMs,
  cooldownMs,
  maxPendingCommands = DEFAULT_MAX_PENDING_COMMANDS,
  logger = console
} = {}) {
  const client = createRedisClient({
    url: resolveApplicationRedisUrl(env),
    // Fail fast while disconnected instead of queueing session commands.
    disableOfflineQueue: true,
    // disableOfflineQueue does not apply to a connection that is open but not
    // answering; this bounds the commands such a connection can retain.
    commandsQueueMaxLength: maxPendingCommands
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
    cooldownMs,
    onTimeout: createConnectionResetter(client, logger),
    logger
  });
}
