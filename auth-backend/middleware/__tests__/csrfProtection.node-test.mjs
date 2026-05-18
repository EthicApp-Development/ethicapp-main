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
  app.get('/api/auth/csrf-token', csrfTokenHandler);
  app.use('/api/auth', csrfProtection);
  app.get('/api/auth/read', (req, res) => res.json({ ok: true }));
  app.post('/api/auth/write', (req, res) => res.json({ ok: true }));

  return app;
}

describe('auth-backend csrfProtection', () => {
  it('allows safe methods without a CSRF token', async () => {
    const app = createTestApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/read`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
  });

  it('issues a session-bound CSRF token', async () => {
    const session = {};
    const app = createTestApp(session);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/csrf-token`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(typeof body.csrfToken, 'string');
      assert.equal(body.csrfToken, session.csrfToken);
    });
  });

  it('rejects mutating requests without the session CSRF token', async () => {
    const app = createTestApp();

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/write`, {
        method: 'POST',
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
      const tokenResponse = await fetch(`${baseUrl}/api/auth/csrf-token`);
      const { csrfToken } = await tokenResponse.json();

      const response = await fetch(`${baseUrl}/api/auth/write`, {
        method: 'POST',
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

  it('allows server-to-server requests with the internal service token', async () => {
    const previousToken = process.env.AUTH_INTERNAL_SERVICE_TOKEN;
    process.env.AUTH_INTERNAL_SERVICE_TOKEN = 'test-internal-token';

    try {
      const app = createTestApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/write`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Service-Token': 'test-internal-token'
          },
          body: JSON.stringify({})
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.AUTH_INTERNAL_SERVICE_TOKEN;
      } else {
        process.env.AUTH_INTERNAL_SERVICE_TOKEN = previousToken;
      }
    }
  });
});
