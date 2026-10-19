import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createSessionJoinRouter } from '../session-join.routes.js';

async function withApp({ session = { uid: 44, role: 'A' }, joinSession }, run) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use(createSessionJoinRouter({
    joinSession,
    query: async () => {
      throw new Error('query must not be called directly');
    },
    getPublisher: () => ({ publish: async () => true })
  }));
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message });
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await run((body, headers = {}) => fetch(`http://127.0.0.1:${port}/sessions/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function joinReturning(outcome, sessionId = 57) {
  const calls = [];
  const joinSession = async (params) => {
    calls.push(params);
    return { outcome, sessionId };
  };
  return { joinSession, calls };
}

test('joined responds 201 with the session id and passes normalized input', async () => {
  const { joinSession, calls } = joinReturning('joined');

  await withApp({ joinSession }, async (post) => {
    const response = await post({ code: ' K0021D ', device: 'web' });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: 'joined', sesid: 57 });
  });

  assert.equal(calls[0].uid, 44);
  assert.equal(calls[0].code, 'k0021d');
  assert.equal(calls[0].device, 'web');
});

test('already_joined responds 200 with the session id', async () => {
  await withApp({ joinSession: joinReturning('already_joined').joinSession }, async (post) => {
    const response = await post({ code: 'k0021d' });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'already_joined', sesid: 57 });
  });
});

test('code_not_found and joining_closed respond 404 and 409 without a session id', async () => {
  await withApp({ joinSession: joinReturning('code_not_found', null).joinSession }, async (post) => {
    const response = await post({ code: 'k0012d' });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.status, 'code_not_found');
    assert.equal(body.sesid, undefined);
  });

  await withApp({ joinSession: joinReturning('joining_closed').joinSession }, async (post) => {
    const response = await post({ code: 'k0021d' });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.status, 'joining_closed');
    assert.equal(body.sesid, undefined);
  });
});

test('error messages follow the canonical locale rule', async () => {
  await withApp({ joinSession: joinReturning('joining_closed').joinSession }, async (post) => {
    const spanish = await (await post({ code: 'k0021d' }, { 'accept-language': 'es-AR' })).json();
    const english = await (await post({ code: 'k0021d' }, { 'accept-language': 'pt-BR' })).json();

    assert.equal(spanish.error, 'Esta sesión ya no admite nuevos participantes');
    assert.equal(english.error, 'This session is no longer accepting participants');
  });
});

test('malformed codes and devices respond 400 without joining', async () => {
  const { joinSession, calls } = joinReturning('joined');

  await withApp({ joinSession }, async (post) => {
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ code: 'k00 21d' })).status, 400);
    assert.equal((await post({ code: 'k0021d', device: 'x'.repeat(65) })).status, 400);
  });

  assert.equal(calls.length, 0);
});

test('unauthenticated and non-student sessions are rejected', async () => {
  const { joinSession, calls } = joinReturning('joined');

  await withApp({ session: {}, joinSession }, async (post) => {
    assert.equal((await post({ code: 'k0021d' })).status, 401);
  });

  await withApp({ session: { uid: 7, role: 'P' }, joinSession }, async (post) => {
    assert.equal((await post({ code: 'k0021d' })).status, 403);
  });

  assert.equal(calls.length, 0);
});

test('service failures are forwarded to the error handler', async () => {
  const joinSession = async () => {
    throw new Error('database unavailable');
  };

  await withApp({ joinSession }, async (post) => {
    assert.equal((await post({ code: 'k0021d' })).status, 500);
  });
});
