import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import studentRoutes from '../student.routes.js';

// Non-student requests must be answered before any handler touches the
// database, so these tests need no PostgreSQL.
async function withApp(session, run) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use('/student/api', studentRoutes);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await run((path, init) => fetch(`http://127.0.0.1:${port}/student/api${path}`, init));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /session answers the role of every authenticated role', async () => {
  for (const role of ['A', 'P', 'S']) {
    await withApp({ uid: 7, role }, async (request) => {
      const response = await request('/session');

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        uid: 7,
        role,
        isAuthenticated: true,
        impersonating: false
      });
    });
  }
});

test('data routes answer 403 to professor and administrator sessions', async () => {
  for (const role of ['P', 'S']) {
    await withApp({ uid: 7, role }, async (request) => {
      const sessions = await request('/sessions');
      const join = await request('/sessions/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'k0021d' })
      });

      assert.equal(sessions.status, 403);
      assert.equal(join.status, 403);
      assert.deepEqual(await sessions.json(), { error: 'User does not have student permissions' });
    });
  }
});

test('data routes answer 401 without a user id', async () => {
  await withApp({}, async (request) => {
    assert.equal((await request('/sessions')).status, 401);
  });
});
