import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { startFakeRedisServer } from '../../../config/__tests__/fake-redis-server.mjs';
import { createDomainEventPublisher } from '../index.js';

const PAYLOAD = { sessionId: 57, userId: 44, device: 'web' };

async function waitFor(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'condition reached before deadline');
    await delay(5);
  }
}

async function createPublisher(t, options = {}) {
  const redis = await startFakeRedisServer();
  const tracker = { pending: 0, resets: 0 };
  const errors = [];
  let client;
  const publisher = createDomainEventPublisher({
    env: { REDIS_APP_URL: `redis://127.0.0.1:${redis.port}` },
    publishTimeoutMs: 100,
    initialConnectionTimeoutMs: 100,
    logger: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    createRedisClient: (clientOptions) => {
      client = createClient(clientOptions);
      const publish = client.publish.bind(client);
      client.publish = (...args) => {
        tracker.pending += 1;
        return publish(...args).finally(() => tracker.pending -= 1);
      };
      const disconnect = client.disconnect.bind(client);
      client.disconnect = () => {
        tracker.resets += 1;
        return disconnect();
      };
      return client;
    },
    ...options
  });

  t.after(async () => {
    await client.disconnect().catch(() => {});
    await redis.close();
  });
  await waitFor(() => client.isReady);
  return { publisher, redis, client, tracker, errors };
}

test('repeated publishes during a connected Redis stall release pending work and recover', async (t) => {
  const { publisher, redis, client, tracker, errors } = await createPublisher(t);
  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), true);

  redis.stall();
  for (let batch = 0; batch < 5; batch += 1) {
    const logStart = errors.length;
    const results = await Promise.all(Array.from({ length: 100 }, () => (
      publisher.publish('session-participant-joined', 1, PAYLOAD)
    )));
    assert.ok(results.every((result) => result === false));
    await waitFor(() => tracker.pending === 0 && redis.heldOnOpenConnections() <= 2);
    assert.ok(redis.heldOnOpenConnections() <= 2, 'only the replacement handshake can remain pending');
    const batchErrors = errors.slice(logStart);
    if (batch === 0) {
      assert.equal(
        batchErrors.filter((entry) => /delivery is unknown and may occur late/.test(entry)).length,
        100,
        'every publish released by the reset has unknown delivery'
      );
      assert.ok(batchErrors.every((entry) => !entry.includes('Could not publish')));
    } else {
      assert.equal(
        batchErrors.filter((entry) => /Could not publish/.test(entry)).length,
        100,
        'publishes submitted while reconnecting fail before transmission'
      );
      assert.ok(batchErrors.every((entry) => !entry.includes('delivery is unknown')));
    }
  }
  assert.equal(tracker.resets, 1, 'one reset, with no resets while reconnecting');

  redis.resume();
  await waitFor(() => client.isReady);
  // Redis may apply PUBLISH commands transmitted before the client reset.
  assert.ok(redis.published.length > 1, 'late delivery is possible after timeout');
  assert.equal(await publisher.publish('session-participant-joined', 1, PAYLOAD), true);
  assert.equal(tracker.pending, 0);
});

test('a publish burst cannot exceed the configured pending command cap', async (t) => {
  const { publisher, redis, tracker } = await createPublisher(t, {
    maxPendingCommands: 10,
    publishTimeoutMs: 500
  });
  redis.stall();

  const requests = Promise.all(Array.from({ length: 100 }, () => (
    publisher.publish('session-participant-joined', 1, PAYLOAD)
  )));
  await waitFor(() => tracker.pending === 10);
  assert.equal(tracker.pending, 10);
  assert.ok((await requests).every((result) => result === false));
  await waitFor(() => tracker.pending === 0);
  assert.equal(tracker.resets, 1);
});
