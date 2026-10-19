import { createDomainEvent, getDomainEventChannel } from './domain-event-envelope.js';

const DEFAULT_INITIAL_CONNECTION_TIMEOUT_MS = 1000;
const TIMED_OUT = Symbol('timed-out');

/**
 * Publishes domain events on Redis pub/sub. Publishing never throws: a failure
 * is logged and reported as `false`, so the originating request is unaffected.
 *
 * The Redis client is expected to run without an offline queue, so commands
 * fail fast while disconnected. To avoid losing events published right after
 * startup, publishing waits for the initial connection, but only once and for
 * at most `initialConnectionTimeoutMs`. After that, or after the initial
 * connection settles, a disconnected client fails immediately.
 */
export class DomainEventPublisher {
  constructor({
    redisClient,
    initialConnection = null,
    initialConnectionTimeoutMs = DEFAULT_INITIAL_CONNECTION_TIMEOUT_MS,
    logger = console,
    now,
    generateId
  }) {
    this.redisClient = redisClient;
    this.initialConnectionTimeoutMs = initialConnectionTimeoutMs;
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

  async waitForInitialConnection() {
    const pending = this.pendingInitialConnection;

    if (!pending) {
      return;
    }

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.initialConnectionTimeoutMs);
      timer.unref?.();
    });

    const outcome = await Promise.race([pending, timeout]);
    clearTimeout(timer);

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
   * @returns {Promise<boolean>} Whether the event was handed to Redis.
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
      await this.redisClient.publish(getDomainEventChannel(type), JSON.stringify(event));
      return true;
    } catch (error) {
      this.logger.error(`[domain-events] Could not publish ${type} event ${event.id}:`, error);
      return false;
    }
  }
}
