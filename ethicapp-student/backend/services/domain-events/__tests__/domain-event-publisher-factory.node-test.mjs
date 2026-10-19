import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainEventPublisher } from '../index.js';

const PAYLOAD = { sessionId: 57, userId: 44, device: 'web' };
const silentLogger = { log: () => {}, error: () => {} };

// Mimics node-redis with disableOfflineQueue: commands are rejected until ready.
function createFakeRedisFactory({ connectDelayMs = 20, connects = true } = {}) {
  const created = [];

  const factory = (options) => {
    const client = {
      options,
      isReady: false,
      published: [],
      on() {
        return client;
      },
      connect() {
        if (!connects) {
          return new Promise(() => {});
        }

        return new Promise((resolve) => {
          setTimeout(() => {
            client.isReady = true;
            resolve(client);
          }, connectDelayMs);
        });
      },
      async publish(channel, message) {
        if (!client.isReady) {
          const error = new Error('The client is offline');
          error.name = 'ClientOfflineError';
          throw error;
        }

        client.published.push({ channel, message });
        return 1;
      }
    };

    created.push(client);
    return client;
  };

  return { factory, created };
}

function createPublisher(fake, options = {}) {
  return createDomainEventPublisher({
    env: { REDIS_SESSION_URL: 'redis://redis.test:6379' },
    createRedisClient: fake.factory,
    logger: silentLogger,
    ...options
  });
}

test('factory configures a fail-fast client on the session Redis URL', () => {
  const fake = createFakeRedisFactory();
  createPublisher(fake);

  assert.deepEqual(fake.created[0].options, {
    url: 'redis://redis.test:6379',
    disableOfflineQueue: true
  });
});

test('first publish right after creation waits for the initial connection', async () => {
  const fake = createFakeRedisFactory({ connectDelayMs: 20 });
  const publisher = createPublisher(fake);

  assert.equal(fake.created[0].isReady, false);
  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), true);
  assert.equal(fake.created[0].published.length, 1);
});

test('concurrent first publishes all succeed once connected', async () => {
  const fake = createFakeRedisFactory({ connectDelayMs: 20 });
  const publisher = createPublisher(fake);

  const results = await Promise.all([
    publisher.publish('session-participant-joined', 1, PAYLOAD),
    publisher.publish('session-participant-joined', 1, { ...PAYLOAD, userId: 45 })
  ]);

  assert.deepEqual(results, [true, true]);
});

test('initial wait is bounded, then publishing fails fast', async () => {
  const fake = createFakeRedisFactory({ connects: false });
  const publisher = createPublisher(fake, { initialConnectionTimeoutMs: 30 });

  let start = Date.now();
  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), false);
  assert.ok(Date.now() - start >= 25, 'first publish waits for the timeout');

  start = Date.now();
  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), false);
  assert.ok(Date.now() - start < 20, 'later publishes do not wait again');
});

test('an outage after the initial connection fails fast', async () => {
  const fake = createFakeRedisFactory({ connectDelayMs: 5 });
  const publisher = createPublisher(fake, { initialConnectionTimeoutMs: 1000 });

  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), true);
  fake.created[0].isReady = false;

  const start = Date.now();
  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), false);
  assert.ok(Date.now() - start < 20);
});
