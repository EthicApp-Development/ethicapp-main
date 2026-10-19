import { createClient } from 'redis';
import { DomainEventPublisher } from './domain-event-publisher.js';

let publisher = null;

// Same Redis instance as Express sessions (application Redis); see #660 for the
// planned REDIS_APP_* names.
export function resolveDomainEventRedisUrl(env = process.env) {
  const host = env.REDIS_SESSION_HOST || 'redis-session';
  const port = env.REDIS_SESSION_PORT || '6379';
  return env.REDIS_SESSION_URL || `redis://${host}:${port}`;
}

function createPublisherRedisClient() {
  const client = createClient({
    url: resolveDomainEventRedisUrl(),
    // Fail fast while disconnected so publishing never stalls a request.
    disableOfflineQueue: true
  });

  client.on('ready', () => {
    console.log('[domain-events] Publisher connected to Redis.');
  });

  client.on('error', (error) => {
    console.error('[domain-events] Publisher Redis error:', error);
  });

  client.connect().catch((error) => {
    console.error('[domain-events] Publisher Redis connection could not be established:', error);
  });

  return client;
}

/**
 * Returns the process-wide publisher, connecting to Redis on first use.
 * @returns {DomainEventPublisher}
 */
export function getDomainEventPublisher() {
  if (!publisher) {
    publisher = new DomainEventPublisher({ redisClient: createPublisherRedisClient() });
  }

  return publisher;
}
