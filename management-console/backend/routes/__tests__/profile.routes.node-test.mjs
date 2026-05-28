import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createProfileRouter } from '../profile.routes.js';

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

function createTestApp(router) {
  const app = express();

  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      uid: 7,
      role: 'S'
    };
    next();
  });
  app.use(router);
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: err.message });
  });

  return app;
}

describe('management-console profile routes', () => {
  it('returns the current administrator profile', async () => {
    const router = createProfileRouter({
      getUserByIdService: async (id) => ({
        id,
        firstname: 'Ada',
        lastname: 'Admin',
        email: 'ada@example.com',
        role: 'S'
      })
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/profile`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: 7,
        firstname: 'Ada',
        lastname: 'Admin',
        email: 'ada@example.com',
        role: 'S'
      });
    });
  });

  it('changes the administrator password through auth-backend', async () => {
    const calls = [];
    const router = createProfileRouter({
      changeAdminPasswordWithAuthBackendService: async (payload) => {
        calls.push(payload);
        return { message: 'Password updated successfully' };
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/profile/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
          'Accept-Language': 'es-CL'
        },
        body: JSON.stringify({
          current_password: 'CurrentPassword123!@',
          new_password: 'FreshPassword123!@',
          password_confirmation: 'FreshPassword123!@'
        })
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        message: 'Password updated successfully'
      });
    });

    assert.deepEqual(calls, [
      {
        currentPassword: 'CurrentPassword123!@',
        newPassword: 'FreshPassword123!@',
        passwordConfirmation: 'FreshPassword123!@',
        cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
        language: 'es-CL'
      }
    ]);
  });

  it('rejects weak new passwords before forwarding to auth-backend', async () => {
    const calls = [];
    const router = createProfileRouter({
      changeAdminPasswordWithAuthBackendService: async (payload) => {
        calls.push(payload);
        return {};
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/profile/password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          current_password: 'CurrentPassword123!@',
          new_password: 'weak',
          password_confirmation: 'weak'
        })
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'WEAK_PASSWORD'
      });
    });

    assert.equal(calls.length, 0);
  });
});
