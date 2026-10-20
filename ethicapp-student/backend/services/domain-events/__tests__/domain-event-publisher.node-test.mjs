import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainEvent } from '../domain-event-envelope.js';
import { DomainEventPublisher } from '../domain-event-publisher.js';

const FIXED_ID = '0b8f5c2e-6a4d-4f43-9a51-2f7f3d1c9e10';
const FIXED_NOW = () => new Date('2026-10-19T15:00:00.000Z');

function createSilentLogger() {
  const errors = [];
  return { errors, error: (...args) => errors.push(args.join(' ')), log: () => {} };
}

function createPublisher(redisClient) {
  const logger = createSilentLogger();
  const publisher = new DomainEventPublisher({
    redisClient,
    logger,
    now: FIXED_NOW,
    generateId: () => FIXED_ID
  });

  return { publisher, logger };
}

test('createDomainEvent builds a v1 session-participant-joined envelope', () => {
  const { event, errors } = createDomainEvent({
    type: 'session-participant-joined',
    version: 1,
    payload: { sessionId: 57, userId: 44, device: 'web' },
    now: FIXED_NOW,
    generateId: () => FIXED_ID
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(event, {
    type: 'session-participant-joined',
    version: 1,
    id: FIXED_ID,
    occurredAt: '2026-10-19T15:00:00.000Z',
    source: 'ethicapp-student',
    payload: { sessionId: 57, userId: 44, device: 'web' }
  });
});

test('createDomainEvent rejects unknown events and invalid payloads', () => {
  assert.equal(createDomainEvent({ type: 'unknown-event', version: 1, payload: {} }).event, null);
  assert.equal(createDomainEvent({ type: 'session-participant-joined', version: 2, payload: {} }).event, null);
  assert.equal(createDomainEvent({ type: 'session-participant-joined', version: 1, payload: [] }).event, null);

  const { event, errors } = createDomainEvent({
    type: 'session-participant-joined',
    version: 1,
    payload: { sessionId: 57, userId: 44, device: 'web', mail: 'student@example.com' }
  });
  assert.equal(event, null);
  assert.deepEqual(errors, ['Unknown payload field: mail.']);
});

test('publish sends the serialized envelope to the event channel', async () => {
  const published = [];
  const { publisher } = createPublisher({
    publish: async (channel, message) => published.push({ channel, message: JSON.parse(message) })
  });

  const result = await publisher.publish('session-participant-joined', 1, { sessionId: 57, userId: 44, device: 'web' });

  assert.equal(result, true);
  assert.equal(published.length, 1);
  assert.equal(published[0].channel, 'ethicapp:events:session-participant-joined');
  assert.equal(published[0].message.id, FIXED_ID);
});

test('publish refuses invalid events without calling Redis', async () => {
  let calls = 0;
  const { publisher, logger } = createPublisher({ publish: async () => { calls += 1; } });

  const result = await publisher.publish('session-participant-joined', 1, { sessionId: 'x', userId: 44, device: 'web' });

  assert.equal(result, false);
  assert.equal(calls, 0);
  assert.equal(logger.errors.length, 1);
});

test('publish reports Redis failures as false without throwing', async () => {
  const { publisher, logger } = createPublisher({
    publish: async () => {
      throw new Error('The client is closed');
    }
  });

  const result = await publisher.publish('session-participant-joined', 1, { sessionId: 57, userId: 44, device: null });

  assert.equal(result, false);
  assert.deepEqual(logger.errors, [
    `[domain-events] Could not publish session-participant-joined event ${FIXED_ID}: The client is closed`
  ]);
});

test('publish gives up after publishTimeoutMs when a connected Redis stops responding', async () => {
  const logger = createSilentLogger();
  const publisher = new DomainEventPublisher({
    redisClient: { publish: () => new Promise(() => {}) },
    publishTimeoutMs: 30,
    logger
  });

  const start = Date.now();
  const result = await publisher.publish('session-participant-joined', 1, { sessionId: 57, userId: 44, device: 'web' });

  assert.equal(result, false);
  assert.ok(Date.now() - start >= 25, 'waits for the publish timeout');
  assert.ok(Date.now() - start < 500, 'does not wait for the stalled command');
  assert.equal(logger.errors.length, 1);
});

test('a PUBLISH that fails after the timeout is not an unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const publisher = new DomainEventPublisher({
      redisClient: {
        publish: () => new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Socket closed unexpectedly')), 40);
        })
      },
      publishTimeoutMs: 10,
      logger: createSilentLogger()
    });

    assert.equal(await publisher.publish('session-participant-joined', 1, { sessionId: 57, userId: 44, device: 'web' }), false);
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

for (const asynchronous of [false, true]) {
  test(`a ${asynchronous ? 'rejected' : 'throwing'} timeout reset cannot fail the originating request`, async () => {
    const logger = createSilentLogger();
    const publisher = new DomainEventPublisher({
      redisClient: { publish: () => new Promise(() => {}) },
      publishTimeoutMs: 10,
      onTimeout: () => {
        if (asynchronous) {
          return Promise.reject(new Error('reset failed'));
        }
        throw new Error('reset failed');
      },
      logger
    });

    assert.equal(await publisher.publish('session-participant-joined', 1, { sessionId: 57, userId: 44, device: 'web' }), false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(logger.errors.some((entry) => /Releasing timed-out Redis operations failed: reset failed/.test(entry)));
  });
}
