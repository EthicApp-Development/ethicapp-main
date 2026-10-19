import { createClient } from 'redis';
import { resolveApplicationRedisUrl } from '../../config/redis.js';
import { DomainEventPublisher } from './domain-event-publisher.js';

let publisher = null;

/**
 * Creates a publisher with its own Redis connection and starts connecting.
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {typeof createClient} [options.createRedisClient] Injectable for tests.
 * @param {number} [options.initialConnectionTimeoutMs]
 * @param {number} [options.publishTimeoutMs]
 * @param {Console} [options.logger]
 * @returns {DomainEventPublisher}
 */
export function createDomainEventPublisher({
  env = process.env,
  createRedisClient = createClient,
  initialConnectionTimeoutMs,
  publishTimeoutMs,
  logger = console
} = {}) {
  const redisClient = createRedisClient({
    url: resolveApplicationRedisUrl(env),
    // Fail fast while disconnected so publishing never stalls a request.
    disableOfflineQueue: true
  });

  redisClient.on('ready', () => {
    logger.log('[domain-events] Publisher connected to Redis.');
  });

  redisClient.on('error', (error) => {
    logger.error('[domain-events] Publisher Redis error:', error);
  });

  const initialConnection = redisClient.connect();
  initialConnection.catch((error) => {
    logger.error('[domain-events] Publisher Redis connection could not be established:', error);
  });

  return new DomainEventPublisher({
    redisClient,
    initialConnection,
    initialConnectionTimeoutMs,
    publishTimeoutMs,
    logger
  });
}

/**
 * Returns the process-wide publisher, creating it on first use.
 * @returns {DomainEventPublisher}
 */
export function getDomainEventPublisher() {
  if (!publisher) {
    publisher = createDomainEventPublisher();
  }

  return publisher;
}

/**
 * Connects the process-wide publisher at service startup, so the connection is
 * usually ready before the first request publishes.
 */
export function startDomainEventPublisher() {
  getDomainEventPublisher();
}
