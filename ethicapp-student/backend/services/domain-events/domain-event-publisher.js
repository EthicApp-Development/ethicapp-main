import { createDomainEvent, getDomainEventChannel } from './domain-event-envelope.js';

/**
 * Publishes domain events on Redis pub/sub. Publishing never throws: a failure
 * is logged and reported as `false`, so the originating request is unaffected.
 */
export class DomainEventPublisher {
  constructor({ redisClient, logger = console, now, generateId }) {
    this.redisClient = redisClient;
    this.logger = logger;
    this.now = now;
    this.generateId = generateId;
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

    try {
      await this.redisClient.publish(getDomainEventChannel(type), JSON.stringify(event));
      return true;
    } catch (error) {
      this.logger.error(`[domain-events] Could not publish ${type} event ${event.id}:`, error);
      return false;
    }
  }
}
