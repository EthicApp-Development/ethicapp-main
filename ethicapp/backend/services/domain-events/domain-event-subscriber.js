import { getDomainEventChannel, parseDomainEventMessage } from "./domain-event-envelope.js";

const DEFAULT_DEDUPLICATION_CAPACITY = 1000;

function handlerKey(type, version) {
    return `${type}@${version}`;
}

/**
 * Subscribes to domain events on Redis pub/sub and dispatches them to handlers
 * registered by event type and version.
 *
 * Delivery is at-most-once: events published while this process is not
 * subscribed are lost. Handlers must tolerate that and must be idempotent.
 */
export class DomainEventSubscriber {
    /**
     * @param {object} options
     * @param {{ subscribe: Function, unsubscribe: Function }} options.redisClient
     *     Dedicated subscriber connection.
     * @param {{ type: string, version: number, handle: Function }[]} [options.handlers]
     * @param {Console} [options.logger]
     * @param {number} [options.deduplicationCapacity] Number of recent event ids remembered.
     */
    constructor({
        redisClient,
        handlers = [],
        logger = console,
        deduplicationCapacity = DEFAULT_DEDUPLICATION_CAPACITY,
    }) {
        this._redisClient = redisClient;
        this._logger = logger;
        this._deduplicationCapacity = deduplicationCapacity;
        this._recentEventIds = new Set();
        this._handlers = new Map();

        for (const handler of handlers) {
            const key = handlerKey(handler.type, handler.version);
            if (this._handlers.has(key)) {
                throw new Error(`Duplicate domain event handler for ${key}.`);
            }
            this._handlers.set(key, handler);
        }
    }

    get channels() {
        const types = new Set(Array.from(this._handlers.values(), handler => handler.type));
        return Array.from(types, getDomainEventChannel);
    }

    async start() {
        for (const channel of this.channels) {
            await this._redisClient.subscribe(channel, (message, receivedChannel) =>
                this.handleMessage(message, receivedChannel ?? channel));
        }
    }

    async stop() {
        const channels = this.channels;
        if (channels.length > 0) {
            await this._redisClient.unsubscribe(channels);
        }
    }

    /**
     * Validates, deduplicates and dispatches one message. Never throws.
     * @param {string} message Raw pub/sub message.
     * @param {string} channel Channel the message arrived on.
     * @returns {Promise<boolean>} Whether a handler processed the event.
     */
    async handleMessage(message, channel) {
        const { event, errors } = parseDomainEventMessage(message);

        if (!event) {
            this._logger.warn(
                `[domain-events] Ignoring invalid event on ${channel}: ${errors.join(" ")}`,
            );
            return false;
        }

        const label = `${event.type} v${event.version} event ${event.id}`;

        if (getDomainEventChannel(event.type) !== channel) {
            this._logger.warn(`[domain-events] Ignoring ${label} received on ${channel}.`);
            return false;
        }

        const handler = this._handlers.get(handlerKey(event.type, event.version));
        if (!handler) {
            this._logger.warn(`[domain-events] No handler registered; ignoring ${label}.`);
            return false;
        }

        if (this._recentEventIds.has(event.id)) {
            this._logger.debug(`[domain-events] Ignoring duplicate event ${event.id}.`);
            return false;
        }
        this._rememberEventId(event.id);

        try {
            await handler.handle(event);
            return true;
        } catch (error) {
            this._logger.error(`[domain-events] Handler failed on ${label}:`, error);
            return false;
        }
    }

    _rememberEventId(eventId) {
        this._recentEventIds.add(eventId);

        if (this._recentEventIds.size > this._deduplicationCapacity) {
            const oldestEventId = this._recentEventIds.values().next().value;
            this._recentEventIds.delete(oldestEventId);
        }
    }
}
