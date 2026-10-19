import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import session from 'express-session';
import hydrateLegacySession from '../../middleware/hydrateLegacySession.js';
import {
  createStudentSessionStore,
  resolveStudentSessionTtlSeconds,
  ResilientSessionStore
} from '../session-store.js';

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
  const store = new ResilientSessionStore({ store: inner, logger });

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

  assert.deepEqual(created[0].options, { url: 'redis://redis.test:6379', disableOfflineQueue: true });
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
