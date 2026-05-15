import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { csrfProtection, csrfTokenHandler } from '../csrfProtection.js';

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const { port } = server.address();

  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createTestApp(sessionStore = {}) {
  const app = express();

  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sessionStore;
    next();
  });
  app.get('/mng/api/csrf-token', csrfTokenHandler);
  app.use('/mng/api', csrfProtection);
  app.get('/mng/api/read', (req, res) => res.json({ ok: true }));
  app.put('/mng/api/write', (req, res) => res.json({ ok: true }));

  return app;
}

describe('management-console csrfProtection', () => {
  it('allows safe methods without a CSRF token', async () => {
    const app = createTestApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/read`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
  });

  it('issues a session-bound CSRF token', async () => {
    const session = {};
    const app = createTestApp(session);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/csrf-token`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(typeof body.csrfToken, 'string');
      assert.equal(body.csrfToken, session.csrfToken);
    });
  });

  it('rejects mutating requests without the session CSRF token', async () => {
    const app = createTestApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/write`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'Invalid CSRF token' });
    });
  });

  it('allows mutating requests with the session CSRF token', async () => {
    const session = {};
    const app = createTestApp(session);

    await withServer(app, async (baseUrl) => {
      const tokenResponse = await fetch(`${baseUrl}/mng/api/csrf-token`);
      const { csrfToken } = await tokenResponse.json();

      const response = await fetch(`${baseUrl}/mng/api/write`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({})
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
  });
});
