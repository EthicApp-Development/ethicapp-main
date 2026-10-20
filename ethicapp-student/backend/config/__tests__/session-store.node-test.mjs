import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import hydrateLegacySession from '../../middleware/hydrateLegacySession.js';
import {
  createStudentSessionStore,
  resolveStudentSessionTtlSeconds,
  ResilientSessionStore
} from '../session-store.js';
import { createConnectionResetter } from '../redis-connection.js';
import { startFakeRedisServer } from './fake-redis-server.mjs';

function createLogger() {
  const entries = { log: [], error: [] };
  return {
    entries,
    log: (...args) => entries.log.push(args.join(' ')),
    error: (...args) => entries.error.push(args.join(' '))
  };
}

// Inner store whose behaviour each test controls: 'ok', 'error', 'hang', 'throw'.
function createControlledStore(mode = 'ok') {
  const data = new Map();
  const state = { mode, calls: 0 };

  const respond = (callback, value) => {
    state.calls += 1;
    if (state.mode === 'throw') {
      throw new Error('synchronous failure');
    }
    if (state.mode === 'hang') {
      return;
    }
    setImmediate(() => (state.mode === 'error' ? callback(new Error('connection refused')) : callback(null, value)));
  };

  return {
    state,
    data,
    get: (sid, callback) => respond(callback, data.get(sid) ?? null),
    set: (sid, sess, callback) => {
      if (state.mode === 'ok') {
        data.set(sid, JSON.parse(JSON.stringify(sess)));
      }
      respond(callback);
    },
    touch: (sid, sess, callback) => respond(callback),
    destroy: (sid, callback) => {
      data.delete(sid);
      respond(callback);
    }
  };
}

function call(store, method, ...args) {
  return new Promise((resolve) => {
    store[method](...args, (...result) => resolve(result));
  });
}

test('operations pass through while the inner store is healthy', async () => {
  const inner = createControlledStore();
  const store = new ResilientSessionStore({ store: inner, logger: createLogger() });

  assert.deepEqual(await call(store, 'set', 'sid-1', { uid: 44 }), [null, undefined]);
  assert.deepEqual(await call(store, 'get', 'sid-1'), [null, { uid: 44 }]);
  assert.deepEqual(await call(store, 'destroy', 'sid-1'), [null, undefined]);
  assert.deepEqual(await call(store, 'get', 'sid-1'), [null, null]);
});

test('errors become an empty read and dropped writes, never a failed request', async () => {
  const inner = createControlledStore('error');
  const store = new ResilientSessionStore({ store: inner, logger: createLogger() });

  assert.deepEqual(await call(store, 'get', 'sid-1'), [null, null]);
  assert.deepEqual(await call(store, 'set', 'sid-1', { uid: 44 }), [null, undefined]);
  assert.deepEqual(await call(store, 'touch', 'sid-1', { uid: 44 }), [null, undefined]);
  assert.deepEqual(await call(store, 'destroy', 'sid-1'), [null, undefined]);
});

test('a store that does not answer is bounded and its late answer ignored', async () => {
  const inner = createControlledStore('hang');
  const store = new ResilientSessionStore({ store: inner, timeoutMs: 20, logger: createLogger() });
  let callbacks = 0;

  const start = Date.now();
  await new Promise((resolve) => {
    store.get('sid-1', (error, value) => {
      callbacks += 1;
      assert.equal(error, null);
      assert.equal(value, null);
      resolve();
    });
  });

  assert.ok(Date.now() - start >= 15);
  assert.equal(callbacks, 1);
});

test('synchronous throws from the inner store are contained', async () => {
  const store = new ResilientSessionStore({ store: createControlledStore('throw'), logger: createLogger() });

  assert.deepEqual(await call(store, 'get', 'sid-1'), [null, null]);
});

test('degradation and recovery are logged once each', async () => {
  const inner = createControlledStore('error');
  const logger = createLogger();
  const store = new ResilientSessionStore({ store: inner, cooldownMs: 0, logger });

  await call(store, 'get', 'a');
  await call(store, 'get', 'b');
  await call(store, 'set', 'c', {});
  inner.state.mode = 'ok';
  await call(store, 'get', 'd');
  await call(store, 'get', 'e');

  assert.equal(logger.entries.error.length, 1);
  assert.match(logger.entries.error[0], /unavailable \(get: connection refused\)/);
  assert.deepEqual(logger.entries.log, ['[student-session] Redis session store recovered.']);
});

test('after a failure the inner store is skipped until the cooldown lets one probe through', async () => {
  const inner = createControlledStore('error');
  let clock = 1000;
  const store = new ResilientSessionStore({
    store: inner,
    cooldownMs: 5000,
    logger: createLogger(),
    now: () => clock
  });

  await call(store, 'get', 'a');
  assert.equal(inner.state.calls, 1);

  inner.state.mode = 'ok';
  inner.data.set('b', { uid: 44 });
  assert.deepEqual(await call(store, 'get', 'b'), [null, null], 'short-circuited to the fallback');
  assert.deepEqual(await call(store, 'set', 'b', { uid: 45 }), [null, undefined]);
  assert.equal(inner.state.calls, 1);

  clock += 5000;
  assert.deepEqual(await call(store, 'get', 'b'), [null, { uid: 44 }], 'the probe reaches the store');
  assert.equal(store.degraded, false);
  assert.deepEqual(await call(store, 'get', 'b'), [null, { uid: 44 }]);
  assert.equal(inner.state.calls, 3);
});

test('a failed probe reopens the circuit for another cooldown', async () => {
  const inner = createControlledStore('error');
  let clock = 0;
  const store = new ResilientSessionStore({ store: inner, cooldownMs: 100, logger: createLogger(), now: () => clock });

  await call(store, 'get', 'a');
  clock = 100;
  await call(store, 'get', 'a');
  assert.equal(inner.state.calls, 2);

  clock = 150;
  await call(store, 'get', 'a');
  assert.equal(inner.state.calls, 2, 'cooldown restarted at the failed probe');
});

test('only one probe reaches the inner store while it is in flight', async () => {
  const inner = createControlledStore('error');
  let clock = 0;
  const store = new ResilientSessionStore({
    store: inner,
    timeoutMs: 20,
    cooldownMs: 100,
    logger: createLogger(),
    now: () => clock
  });

  await call(store, 'get', 'a');
  inner.state.mode = 'hang';
  clock = 100;

  await Promise.all(Array.from({ length: 10 }, (_, index) => call(store, 'get', `sid-${index}`)));
  assert.equal(inner.state.calls, 2);
});

test('timeouts ask for the stalled operations to be released; fast errors do not', async () => {
  const inner = createControlledStore('error');
  let releases = 0;
  const store = new ResilientSessionStore({
    store: inner,
    timeoutMs: 20,
    cooldownMs: 0,
    onTimeout: () => {
      releases += 1;
    },
    logger: createLogger()
  });

  await call(store, 'get', 'a');
  assert.equal(releases, 0);

  inner.state.mode = 'hang';
  await call(store, 'get', 'a');
  assert.equal(releases, 1);
});

test('a failing release is logged and does not affect the request', async () => {
  const logger = createLogger();
  const store = new ResilientSessionStore({
    store: createControlledStore('hang'),
    timeoutMs: 20,
    onTimeout: async () => {
      throw new Error('boom');
    },
    logger
  });

  assert.deepEqual(await call(store, 'get', 'a'), [null, null]);
  await delay(0);
  assert.ok(logger.entries.error.some((entry) => /Releasing timed-out Redis operations failed: boom/.test(entry)));
});

function createFakeRedisClient() {
  const client = {
    isReady: true,
    disconnects: 0,
    connects: 0,
    async disconnect() {
      client.disconnects += 1;
      client.isReady = false;
      await delay(5);
    },
    connect() {
      client.connects += 1;
      return new Promise(() => {});
    }
  };
  return client;
}

test('the connection resetter replaces a ready connection once, even when asked repeatedly', async () => {
  const client = createFakeRedisClient();
  const reset = createConnectionResetter(client, createLogger(), 'student-session');

  await Promise.all([reset(), reset(), reset()]);
  assert.equal(client.disconnects, 1);
  assert.equal(client.connects, 1);

  await reset();
  assert.equal(client.disconnects, 1, 'a reconnecting client is left alone');
});

test('resolveStudentSessionTtlSeconds defaults to the 24 h student idle timeout', () => {
  assert.equal(resolveStudentSessionTtlSeconds({}), 86400);
  assert.equal(resolveStudentSessionTtlSeconds({ ETHICAPP_STUDENT_SESSION_TTL_SECONDS: '3600' }), 3600);
  assert.equal(resolveStudentSessionTtlSeconds({ ETHICAPP_STUDENT_SESSION_TTL_SECONDS: 'abc' }), 86400);
  assert.equal(resolveStudentSessionTtlSeconds({ ETHICAPP_STUDENT_SESSION_TTL_SECONDS: '-5' }), 86400);
});

test('createStudentSessionStore uses the application Redis with a fail-fast client', () => {
  const created = [];
  const fakeCreateClient = (options) => {
    const client = { options, on: () => client, connect: () => new Promise(() => {}) };
    created.push(client);
    return client;
  };

  const store = createStudentSessionStore({
    env: {
      REDIS_SESSION_URL: 'redis://redis.test:6379',
      ETHICAPP_STUDENT_SESSION_REDIS_PREFIX: 'custom:',
      ETHICAPP_STUDENT_SESSION_TTL_SECONDS: '3600'
    },
    createRedisClient: fakeCreateClient,
    logger: createLogger()
  });

  assert.deepEqual(created[0].options, {
    url: 'redis://redis.test:6379',
    disableOfflineQueue: true,
    commandsQueueMaxLength: 100
  });
  assert.ok(store instanceof ResilientSessionStore);
  assert.equal(store.store.prefix, 'custom:');
  assert.equal(store.store.ttl, 3600);

  const defaults = createStudentSessionStore({ env: {}, createRedisClient: fakeCreateClient, logger: createLogger() });
  assert.equal(created[1].options.url, 'redis://redis-session:6379');
  assert.equal(defaults.store.prefix, 'ethicapp-student:sess:');
  assert.equal(defaults.store.ttl, 86400);
});

async function withSessionApp(innerStore, run) {
  const app = express();
  app.use(session({
    store: new ResilientSessionStore({ store: innerStore, timeoutMs: 30, logger: createLogger() }),
    name: 'ethicapp.student.sid',
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false
  }));
  app.use(hydrateLegacySession);
  app.get('/whoami', (req, res) => {
    req.session.visits = (req.session.visits ?? 0) + 1;
    res.json({ uid: req.session.uid ?? null, role: req.session.role ?? null, visits: req.session.visits });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    await run((headers = {}) => fetch(`http://127.0.0.1:${port}/whoami`, { headers }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const STUDENT_HEADERS = { 'X-User-Id': '44', 'X-User-Role': 'A' };

for (const mode of ['error', 'hang']) {
  test(`requests keep their header identity while Redis is ${mode === 'error' ? 'down' : 'unresponsive'}`, async () => {
    await withSessionApp(createControlledStore(mode), async (get) => {
      const start = Date.now();
      const response = await get(STUDENT_HEADERS);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { uid: 44, role: 'A', visits: 1 });
      assert.ok(Date.now() - start < 1000, 'bounded by the store timeout');
    });
  });
}

test('sessions persist across requests while Redis is healthy', async () => {
  const inner = createControlledStore('ok');

  await withSessionApp(inner, async (get) => {
    const first = await get(STUDENT_HEADERS);
    const cookie = first.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await first.json(), { uid: 44, role: 'A', visits: 1 });

    const second = await get({ ...STUDENT_HEADERS, cookie });
    assert.deepEqual(await second.json(), { uid: 44, role: 'A', visits: 2 });
    assert.equal(inner.data.size, 1);
  });
});

// Counts session commands issued through the real node-redis client that have
// not settled yet: the work a stalled connection keeps alive.
function trackPendingCommands(client, tracker) {
  for (const method of ['get', 'set', 'expire', 'del']) {
    const original = client[method].bind(client);
    client[method] = (...args) => {
      tracker.pending += 1;
      return original(...args).finally(() => {
        tracker.pending -= 1;
      });
    };
  }
}

async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await delay(5);
  }
}

async function createStoreOnFakeRedis(t, options) {
  const redis = await startFakeRedisServer();
  const tracker = { pending: 0 };
  const logger = createLogger();
  let client;

  const store = createStudentSessionStore({
    env: { REDIS_SESSION_URL: `redis://127.0.0.1:${redis.port}` },
    createRedisClient: (clientOptions) => {
      client = createClient(clientOptions);
      trackPendingCommands(client, tracker);
      return client;
    },
    logger,
    ...options
  });

  t.after(async () => {
    await client.disconnect().catch(() => {});
    await redis.close();
  });
  await waitFor(() => client.isReady);

  return { redis, store, tracker, logger, client: () => client };
}

test('a connected Redis that stops answering retains bounded work and recovers', async (t) => {
  const { redis, store, tracker, logger, client } = await createStoreOnFakeRedis(t, {
    timeoutMs: 20,
    cooldownMs: 50
  });

  assert.deepEqual(await call(store, 'set', 'sid-kept', { uid: 44 }), [null, null]);
  assert.deepEqual(await call(store, 'get', 'sid-kept'), [null, { uid: 44 }]);

  redis.stall();
  const retained = [];
  for (let batch = 0; batch < 5; batch += 1) {
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => (
      index % 2 === 0
        ? call(store, 'set', `sid-${batch}-${index}`, { uid: index })
        : call(store, 'get', `sid-${batch}-${index}`)
    )));
    assert.ok(results.every(([error]) => error === null), 'every request is served by the fallback');

    // Longer than the cooldown, so every later batch includes a probe.
    await delay(60);
    // Closing the peer socket is asynchronous, especially under Docker load.
    await waitFor(() => tracker.pending === 0 && redis.heldOnOpenConnections() <= 2);
    retained.push({ client: tracker.pending, server: redis.heldOnOpenConnections() });
  }

  // Before the fix this grew by 100 per batch. Now the timed-out commands are
  // released by the reset, and the replacement connection only holds the
  // handshake it is waiting on (CLIENT SETINFO) while Redis is stalled.
  for (const { client: pending, server: held } of retained) {
    assert.equal(pending, 0);
    assert.ok(held <= 2, `the open connection holds ${held} commands`);
  }
  assert.equal(
    logger.entries.error.filter((entry) => /resetting the connection/.test(entry)).length,
    1
  );

  redis.resume();
  await waitFor(() => client().isReady);
  await delay(60);

  assert.deepEqual(await call(store, 'get', 'sid-kept'), [null, { uid: 44 }], 'the probe reaches Redis again');
  assert.equal(store.degraded, false);
  assert.ok(logger.entries.log.includes('[student-session] Redis session store recovered.'));

  assert.deepEqual(await call(store, 'set', 'sid-after', { uid: 45 }), [null, null]);
  assert.deepEqual(await call(store, 'get', 'sid-after'), [null, { uid: 45 }]);
});

test('the session connection never holds more than maxPendingCommands', async (t) => {
  const { redis, store, tracker } = await createStoreOnFakeRedis(t, {
    timeoutMs: 200,
    maxPendingCommands: 100
  });

  redis.stall();
  const requests = Promise.all(Array.from({ length: 300 }, (_, index) => call(store, 'get', `sid-${index}`)));

  // Commands beyond the cap are rejected at once instead of being queued.
  await delay(50);
  assert.equal(tracker.pending, 100);

  await requests;
  await delay(20);
  assert.equal(tracker.pending, 0, 'the timeout releases the queued commands');
});
