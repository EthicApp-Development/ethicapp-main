import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import requireStudentRole from '../requireStudentRole.js';

async function withApp(session, run) {
  const app = express();
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use(requireStudentRole);
  app.get('/data', (req, res) => {
    res.json({ reached: true });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await run((headers = {}) => fetch(`http://127.0.0.1:${port}/data`, { headers }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a student session reaches the handler', async () => {
  await withApp({ uid: 44, role: 'A' }, async (get) => {
    const response = await get();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reached: true });
  });
});

test('professor and administrator sessions get 403 before the handler', async () => {
  for (const role of ['P', 'S']) {
    await withApp({ uid: 7, role }, async (get) => {
      const response = await get();

      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'User does not have student permissions' });
    });
  }
});

test('a session without a role gets 403', async () => {
  await withApp({ uid: 7, role: null }, async (get) => {
    assert.equal((await get()).status, 403);
  });
});

test('a request without a user id gets 401', async () => {
  for (const session of [undefined, {}, { uid: 0, role: 'A' }, { uid: 'abc', role: 'A' }]) {
    await withApp(session, async (get) => {
      const response = await get();

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'User not authenticated' });
    });
  }
});

test('the 403 message follows the canonical locale rule', async () => {
  await withApp({ uid: 7, role: 'P' }, async (get) => {
    const spanish = await (await get({ 'accept-language': 'es-AR,es;q=0.9' })).json();
    const english = await (await get({ 'accept-language': 'pt-BR' })).json();

    assert.equal(spanish.error, 'Usuario sin permisos de estudiante');
    assert.equal(english.error, 'User does not have student permissions');
  });
});
