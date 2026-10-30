import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createUsersRouter } from '../users.routes.js';

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
    req.session = { uid: 7, role: 'S' };
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

function createDeleteAccountRouter(overrides = {}) {
  const calls = {
    recaptcha: [],
    password: [],
    passkey: [],
    deletion: []
  };

  const router = createUsersRouter({
    verifyRecaptchaTokenService: async (payload) => {
      calls.recaptcha.push(payload);
      return true;
    },
    verifyAdminPasswordWithAuthBackendService: async (payload) => {
      calls.password.push(payload);
      return true;
    },
    verifyAdminPasskeyWithAuthBackendService: async (payload) => {
      calls.passkey.push(payload);
      return true;
    },
    listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [] }),
    deleteNeverActivatedAccountService: async (payload) => {
      calls.deletion.push(payload);
      return { id: payload.userId, deleted: true };
    },
    ...overrides
  });

  return { calls, router };
}

async function deleteAccount(baseUrl, userId, body) {
  return fetch(`${baseUrl}/mng/api/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'auth.sid=auth-session',
      'Accept-Language': 'es-CL'
    },
    body: JSON.stringify(body)
  });
}

function deletionError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

const PASSWORD_STEP_UP = Object.freeze({
  admin_password: 'admin-secret',
  recaptcha_token: 'test-recaptcha-token'
});

describe('management-console delete-account route', () => {
  it('deletes a never-activated account after the step-up confirmation, as the signed-in administrator', async () => {
    const { calls, router } = createDeleteAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await deleteAccount(baseUrl, 22, {
        ...PASSWORD_STEP_UP,
        expected_email: 'stored@example.test'
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: 22, deleted: true });
    });

    assert.equal(calls.recaptcha.length, 1);
    assert.equal(calls.password.length, 1);
    assert.deepEqual(calls.deletion, [
      { adminUserId: 7, userId: 22, expectedEmail: 'stored@example.test' }
    ]);
  });

  it('passes a missing expected email on as null, for the service to refuse', async () => {
    const { calls, router } = createDeleteAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await deleteAccount(baseUrl, 22, PASSWORD_STEP_UP);
      assert.equal(response.status, 200);
    });

    assert.deepEqual(calls.deletion, [{ adminUserId: 7, userId: 22, expectedEmail: null }]);
  });

  it('rejects an invalid user id or expected email before the step-up confirmation', async () => {
    const { calls, router } = createDeleteAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const invalidId = await deleteAccount(baseUrl, 'abc', PASSWORD_STEP_UP);
      assert.equal(invalidId.status, 400);
      assert.deepEqual(await invalidId.json(), { error: 'INVALID_USER_ID' });

      const invalidEmail = await deleteAccount(baseUrl, 22, {
        ...PASSWORD_STEP_UP,
        expected_email: { mail: 'stored@example.test' }
      });
      assert.equal(invalidEmail.status, 400);
      assert.deepEqual(await invalidEmail.json(), { error: 'INVALID_EXPECTED_EMAIL' });
    });

    assert.equal(calls.recaptcha.length, 0);
    assert.equal(calls.password.length, 0);
    assert.equal(calls.deletion.length, 0);
  });

  it('accepts a passkey confirmation', async () => {
    const { calls, router } = createDeleteAccountRouter({
      listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [{ id: 4 }] })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await deleteAccount(baseUrl, 22, {
        passkey_assertion: { id: 'credential-123' },
        expected_email: 'stored@example.test'
      });
      assert.equal(response.status, 200);
    });

    assert.equal(calls.passkey.length, 1);
    assert.equal(calls.password.length, 0);
    assert.equal(calls.deletion.length, 1);
  });

  it('does not delete when the step-up confirmation is refused or a passkey is required', async () => {
    for (const [overrides, expected] of [
      [{ verifyAdminPasswordWithAuthBackendService: async () => false }, { error: 'Invalid administrator password' }],
      [{ listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [{ id: 4 }] }) }, { error: 'PASSKEY_REQUIRED' }]
    ]) {
      const { calls, router } = createDeleteAccountRouter(overrides);

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await deleteAccount(baseUrl, 22, PASSWORD_STEP_UP);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), expected);
      });

      assert.equal(calls.deletion.length, 0);
    }
  });

  it('maps the refusals to 409 with their details', async () => {
    for (const [error, body] of [
      [
        deletionError('ACCOUNT_NOT_DELETABLE', { accountStatus: 'active' }),
        { error: 'ACCOUNT_NOT_DELETABLE', status: 'active' }
      ],
      [deletionError('ACCOUNT_CHANGED'), { error: 'ACCOUNT_CHANGED' }],
      [
        deletionError('ACCOUNT_REFERENCED', { referencedBy: 'sesusers', referenceCategory: 'activities' }),
        { error: 'ACCOUNT_REFERENCED', referenced_by: 'sesusers', reference_category: 'activities' }
      ]
    ]) {
      const { router } = createDeleteAccountRouter({
        deleteNeverActivatedAccountService: async () => {
          throw error;
        }
      });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await deleteAccount(baseUrl, 22, PASSWORD_STEP_UP);
        assert.equal(response.status, 409, error.code);
        assert.deepEqual(await response.json(), body);
      });
    }
  });

  it('answers 404 USER_NOT_FOUND for a missing account', async () => {
    const { router } = createDeleteAccountRouter({
      deleteNeverActivatedAccountService: async () => {
        throw deletionError('USER_NOT_FOUND');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await deleteAccount(baseUrl, 404, PASSWORD_STEP_UP);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'USER_NOT_FOUND' });
    });
  });

  it('passes unexpected failures to the error handler', async () => {
    const { router } = createDeleteAccountRouter({
      deleteNeverActivatedAccountService: async () => {
        throw new Error('deadlock detected');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await deleteAccount(baseUrl, 22, PASSWORD_STEP_UP);
      assert.equal(response.status, 500);
    });
  });

  it('is behind the management role middleware', async () => {
    const { calls, router } = createDeleteAccountRouter({
      requireManagementRoleMiddleware: (req, res) => res.status(403).json({ error: 'Forbidden' })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await deleteAccount(baseUrl, 22, PASSWORD_STEP_UP);
      assert.equal(response.status, 403);
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.deletion.length, 0);
  });
});
