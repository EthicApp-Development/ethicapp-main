import { DisconnectsClientError } from 'redis';
import { createDomainEvent, getDomainEventChannel } from './domain-event-envelope.js';

const DEFAULT_INITIAL_CONNECTION_TIMEOUT_MS = 1000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 500;
const TIMED_OUT = Symbol('timed-out');

/**
 * Resolves with the promise's value, or with TIMED_OUT after `timeoutMs`.
 * Rejections of `promise` propagate, including late ones being observed here,
 * so an abandoned promise never becomes an unhandled rejection.
 */
async function raceWithTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Publishes domain events on Redis pub/sub. Publishing never throws and never
 * waits without bound: a failure or timeout is logged and reported as `false`,
 * so the originating request is unaffected.
 *
 * - The Redis client is expected to run without an offline queue, so commands
 *   fail fast while the client knows it is disconnected.
 * - Publishes issued before the first connection completes wait for it once,
 *   for at most `initialConnectionTimeoutMs`.
 * - Each PUBLISH waits at most `publishTimeoutMs`, which covers a connection
 *   that is still open but whose server stopped responding. The factory caps
 *   pending commands and resets the dedicated connection on timeout. Commands
 *   already transmitted may still be delivered late; false means unconfirmed
 *   delivery, and the publisher does not retry automatically.
 */
export class DomainEventPublisher {
  constructor({
    redisClient,
    initialConnection = null,
    initialConnectionTimeoutMs = DEFAULT_INITIAL_CONNECTION_TIMEOUT_MS,
    publishTimeoutMs = DEFAULT_PUBLISH_TIMEOUT_MS,
    onTimeout = () => {},
    logger = console,
    now,
    generateId
  }) {
    this.redisClient = redisClient;
    this.initialConnectionTimeoutMs = initialConnectionTimeoutMs;
    this.publishTimeoutMs = publishTimeoutMs;
    this.onTimeout = onTimeout;
    this.logger = logger;
    this.now = now;
    this.generateId = generateId;
    this.pendingInitialConnection = null;

    if (initialConnection) {
      const settled = Promise.resolve(initialConnection).then(() => true, () => false);
      this.pendingInitialConnection = settled;
      settled.then(() => {
        if (this.pendingInitialConnection === settled) {
          this.pendingInitialConnection = null;
        }
      });
    }
  }

  releaseTimedOutCommands() {
    try {
      Promise.resolve(this.onTimeout()).catch((error) => {
        this.logger.error('[domain-events] Releasing timed-out Redis operations failed:', error.message);
      });
    } catch (error) {
      this.logger.error('[domain-events] Releasing timed-out Redis operations failed:', error.message);
    }
  }

  async waitForInitialConnection() {
    const pending = this.pendingInitialConnection;

    if (!pending) {
      return;
    }

    const outcome = await raceWithTimeout(pending, this.initialConnectionTimeoutMs);

    if (outcome === TIMED_OUT && this.pendingInitialConnection === pending) {
      this.pendingInitialConnection = null;
      this.logger.error(
        `[domain-events] Redis not ready after ${this.initialConnectionTimeoutMs} ms; ` +
        'publishing will fail fast until it connects.'
      );
    }
  }

  /**
   * @param {string} type Kebab-case event type.
   * @param {number} version Event version.
   * @param {object} payload Event payload, validated against the known contract.
   * @returns {Promise<boolean>} Whether Redis accepted the event in time.
   */
  async publish(type, version, payload) {
    const { event, errors } = createDomainEvent({
      type,
      version,
      payload,
      now: this.now,
      generateId: this.generateId
    });

    if (!event) {
      this.logger.error(`[domain-events] Refusing to publish ${type} v${version}: ${errors.join(' ')}`);
      return false;
    }

    await this.waitForInitialConnection();

    try {
      const publishing = Promise.resolve().then(() =>
        this.redisClient.publish(getDomainEventChannel(type), JSON.stringify(event)));
      const outcome = await raceWithTimeout(publishing, this.publishTimeoutMs);

      if (outcome === TIMED_OUT) {
        this.releaseTimedOutCommands();
        this.logger.error(
          `[domain-events] Redis did not confirm ${type} event ${event.id} ` +
          `within ${this.publishTimeoutMs} ms; delivery is unknown and may occur late.`
        );
        return false;
      }

      return true;
    } catch (error) {
      if (error instanceof DisconnectsClientError) {
        // A reset also rejects peers of the command that timed out. Their
        // commands may already be on the wire, so delivery is still unknown.
        this.logger.error(
          `[domain-events] Redis connection closed before confirming ${type} event ${event.id}; ` +
          'delivery is unknown and may occur late.'
        );
      } else {
        this.logger.error(`[domain-events] Could not publish ${type} event ${event.id}:`, error.message);
      }
      return false;
    }
  }
}
