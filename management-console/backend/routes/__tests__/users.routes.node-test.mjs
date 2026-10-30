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

function createImpersonationRouter(overrides = {}) {
  const calls = {
    recaptcha: [],
    password: [],
    impersonation: []
  };

  const router = createUsersRouter({
    getUserByIdService: async (id) => ({
      id: Number(id),
      role: 'P',
      email: 'professor@test'
    }),
    verifyRecaptchaTokenService: async (payload) => {
      calls.recaptcha.push(payload);
      return true;
    },
    verifyAdminPasswordWithAuthBackendService: async (payload) => {
      calls.password.push(payload);
      return true;
    },
    listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [] }),
    impersonateProfessorInEthicappService: async (payload) => {
      calls.impersonation.push(payload);
      return {
        body: {
          ok: true,
          redirectTo: '/home'
        },
        setCookies: ['ethicapp.sid=legacy-session; Path=/; HttpOnly; SameSite=Lax']
      };
    },
    listUsersService: async () => ({ items: [], total: 0 }),
    updateUserByIdService: async () => ({}),
    triggerForgotPasswordWithAuthBackendService: async () => ({}),
    ...overrides
  });

  return {
    calls,
    router
  };
}

function createConfirmAccountRouter(overrides = {}) {
  const calls = {
    recaptcha: [],
    password: [],
    passkey: [],
    confirm: []
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
    confirmPendingAccountService: async (payload) => {
      calls.confirm.push(payload);
      return { id: payload.userId, status: 'active' };
    },
    ...overrides
  });

  return { calls, router };
}

async function postConfirmAccount(baseUrl, userId, body) {
  return fetch(`${baseUrl}/mng/api/users/${userId}/confirm-account`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'auth.sid=auth-session',
      'Accept-Language': 'es-CL'
    },
    body: JSON.stringify(body)
  });
}

function lifecycleError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

describe('management-console confirm-account route', () => {
  it('confirms a pending account after the step-up confirmation, as the signed-in administrator', async () => {
    const { calls, router } = createConfirmAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        expected_email: 'stored@example.test',
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: 22, status: 'active' });
    });

    assert.equal(calls.recaptcha.length, 1);
    assert.equal(calls.password.length, 1);
    assert.deepEqual(calls.confirm, [
      { adminUserId: 7, userId: 22, expectedEmail: 'stored@example.test' }
    ]);
  });

  it('passes a missing expected email on as null, for the service to refuse', async () => {
    const { calls, router } = createConfirmAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 200);
    });

    assert.deepEqual(calls.confirm, [{ adminUserId: 7, userId: 22, expectedEmail: null }]);
  });

  it('rejects an expected email that is not a string before the step-up confirmation', async () => {
    const { calls, router } = createConfirmAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        expected_email: ['stored@example.test'],
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'INVALID_EXPECTED_EMAIL' });
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.confirm.length, 0);
  });

  it('answers 409 ACCOUNT_CHANGED when the account no longer has the approved email', async () => {
    const { router } = createConfirmAccountRouter({
      confirmPendingAccountService: async () => {
        throw lifecycleError('ACCOUNT_CHANGED');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        expected_email: 'edited-but-unsaved@example.test',
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'ACCOUNT_CHANGED' });
    });
  });

  it('accepts a passkey confirmation', async () => {
    const { calls, router } = createConfirmAccountRouter({
      listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [{ id: 4 }] })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        passkey_assertion: { id: 'credential-123' }
      });

      assert.equal(response.status, 200);
    });

    assert.equal(calls.passkey.length, 1);
    assert.equal(calls.password.length, 0);
    assert.equal(calls.confirm.length, 1);
  });

  it('does not confirm when the step-up confirmation is refused', async () => {
    const { calls, router } = createConfirmAccountRouter({
      verifyAdminPasswordWithAuthBackendService: async () => false
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        admin_password: 'wrong',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Invalid administrator password' });
    });

    assert.equal(calls.confirm.length, 0);
  });

  it('requires a passkey when the administrator has one', async () => {
    const { calls, router } = createConfirmAccountRouter({
      listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [{ id: 4 }] })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'PASSKEY_REQUIRED' });
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.confirm.length, 0);
  });

  it('rejects an invalid user id before the step-up confirmation', async () => {
    const { calls, router } = createConfirmAccountRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 'abc', {
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'INVALID_USER_ID' });
    });

    assert.equal(calls.recaptcha.length, 0);
    assert.equal(calls.password.length, 0);
    assert.equal(calls.confirm.length, 0);
  });

  it('answers 409 ACCOUNT_NOT_PENDING with the current status for an account that is not pending', async () => {
    for (const accountStatus of ['active', 'inactive', 'anonymized']) {
      const { router } = createConfirmAccountRouter({
        confirmPendingAccountService: async () => {
          throw lifecycleError('ACCOUNT_NOT_PENDING', { accountStatus });
        }
      });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await postConfirmAccount(baseUrl, 22, {
          admin_password: 'admin-secret',
          recaptcha_token: 'test-recaptcha-token'
        });

        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: 'ACCOUNT_NOT_PENDING', status: accountStatus });
      });
    }
  });

  it('answers 404 USER_NOT_FOUND for a missing account', async () => {
    const { router } = createConfirmAccountRouter({
      confirmPendingAccountService: async () => {
        throw lifecycleError('USER_NOT_FOUND');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 404, {
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'USER_NOT_FOUND' });
    });
  });

  it('passes unexpected failures to the error handler', async () => {
    const { router } = createConfirmAccountRouter({
      confirmPendingAccountService: async () => {
        throw new Error('deadlock detected');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 500);
    });
  });

  it('is behind the management role middleware', async () => {
    const { calls, router } = createConfirmAccountRouter({
      requireManagementRoleMiddleware: (req, res) => res.status(403).json({ error: 'Forbidden' })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await postConfirmAccount(baseUrl, 22, {
        admin_password: 'admin-secret',
        recaptcha_token: 'test-recaptcha-token'
      });

      assert.equal(response.status, 403);
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.confirm.length, 0);
  });
});

describe('management-console user routes', () => {
  it('passes the status filter to the users list', async () => {
    const listCalls = [];
    const router = createUsersRouter({
      listUsersService: async (payload) => {
        listCalls.push(payload);
        return { items: [], total: 0 };
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users?status=pending&role=A&page=2`);
      assert.equal(response.status, 200);
    });

    assert.deepEqual(listCalls, [
      { keywords: '', role: 'A', status: 'pending', page: 2, pageSize: 10 }
    ]);
  });

  it('updates account active state after admin confirmation', async () => {
    const calls = {
      password: [],
      update: []
    };
    const router = createUsersRouter({
      verifyRecaptchaTokenService: async () => true,
      verifyAdminPasswordWithAuthBackendService: async (payload) => {
        calls.password.push(payload);
        return true;
      },
      listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [] }),
      updateUserByIdService: async (id, payload) => {
        calls.update.push({ id, payload });
        return {
          id: Number(id),
          active: payload.active,
          emailConfirmed: payload.active
        };
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'auth.sid=auth-session',
          'Accept-Language': 'en-US'
        },
        body: JSON.stringify({
          firstname: 'Pat',
          lastname: 'Teacher',
          sex: 'O',
          email: 'pat@example.com',
          email_confirmation: 'pat@example.com',
          role: 'P',
          active: true,
          admin_password: 'admin-secret',
          recaptcha_token: 'test-recaptcha-token'
        })
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: 22,
        active: true,
        emailConfirmed: true
      });
    });

    assert.equal(calls.password.length, 1);
    assert.deepEqual(calls.update, [
      {
        id: '22',
        payload: {
          firstname: 'Pat',
          lastname: 'Teacher',
          sex: 'O',
          email: 'pat@example.com',
          email_confirmation: 'pat@example.com',
          role: 'P',
          active: true,
          admin_password: 'admin-secret',
          recaptcha_token: 'test-recaptcha-token'
        }
      }
    ]);
  });

  it('updates account data after passkey confirmation without reCAPTCHA or password', async () => {
    const calls = {
      recaptcha: [],
      password: [],
      passkey: [],
      update: []
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
      listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [{ id: 4 }] }),
      updateUserByIdService: async (id, payload) => {
        calls.update.push({ id, payload });
        return {
          id: Number(id),
          active: payload.active,
          emailConfirmed: payload.active
        };
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'auth.sid=auth-session',
          Origin: 'http://localhost',
          'Accept-Language': 'en-US'
        },
        body: JSON.stringify({
          firstname: 'Pat',
          lastname: 'Teacher',
          sex: 'O',
          email: 'pat@example.com',
          email_confirmation: 'pat@example.com',
          role: 'P',
          active: true,
          passkey_assertion: { id: 'credential-123' }
        })
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: 22,
        active: true,
        emailConfirmed: true
      });
    });

    assert.equal(calls.recaptcha.length, 0);
    assert.equal(calls.password.length, 0);
    assert.deepEqual(calls.passkey, [
      {
        assertion: { id: 'credential-123' },
        cookie: 'auth.sid=auth-session',
        language: 'en-US',
        origin: 'http://localhost'
      }
    ]);
  });

  it('rejects password fallback for user updates when the administrator has passkeys', async () => {
    const calls = {
      recaptcha: [],
      password: [],
      update: []
    };
    const router = createUsersRouter({
      listAdminPasskeysWithAuthBackendService: async () => ({ passkeys: [{ id: 4 }] }),
      verifyRecaptchaTokenService: async (payload) => {
        calls.recaptcha.push(payload);
        return true;
      },
      verifyAdminPasswordWithAuthBackendService: async (payload) => {
        calls.password.push(payload);
        return true;
      },
      updateUserByIdService: async (id, payload) => {
        calls.update.push({ id, payload });
        return {};
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'auth.sid=auth-session',
          'Accept-Language': 'en-US'
        },
        body: JSON.stringify({
          firstname: 'Pat',
          lastname: 'Teacher',
          sex: 'O',
          email: 'pat@example.com',
          email_confirmation: 'pat@example.com',
          role: 'P',
          active: true,
          admin_password: 'admin-secret',
          recaptcha_token: 'test-recaptcha-token'
        })
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: 'PASSKEY_REQUIRED'
      });
    });

    assert.equal(calls.recaptcha.length, 0);
    assert.equal(calls.password.length, 0);
    assert.equal(calls.update.length, 0);
  });

  it('starts professor impersonation and forwards the EthicApp session cookie', async () => {
    const { calls, router } = createImpersonationRouter();
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22/impersonate-professor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'platform.ethicapp.info',
          'X-Forwarded-Port': '443',
          'Accept-Language': 'es-CL',
          'User-Agent': 'management-console-test'
        },
        body: JSON.stringify({
          admin_password: 'admin-secret',
          recaptcha_token: 'test-recaptcha-token'
        })
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        redirectTo: '/home'
      });
      assert.match(response.headers.get('set-cookie'), /ethicapp\.sid=legacy-session/);
    });

    assert.deepEqual(calls.recaptcha, [
      {
        token: 'test-recaptcha-token',
        remoteIp: '127.0.0.1',
        userAgent: 'management-console-test'
      }
    ]);
    assert.deepEqual(calls.password, [
      {
        password: 'admin-secret',
        cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
        language: 'es-CL'
      }
    ]);
    assert.deepEqual(calls.impersonation, [
      {
        professorId: 22,
        cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
        userId: 7,
        userRole: 'S',
        forwardedProto: 'https',
        forwardedHost: 'platform.ethicapp.info',
        forwardedPort: '443'
      }
    ]);
  });

  it('starts professor impersonation after passkey confirmation without reCAPTCHA or password', async () => {
    const { calls, router } = createImpersonationRouter({
      verifyAdminPasskeyWithAuthBackendService: async (payload) => {
        calls.passkey = calls.passkey || [];
        calls.passkey.push(payload);
        return true;
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22/impersonate-professor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
          Origin: 'http://localhost',
          'Accept-Language': 'es-CL'
        },
        body: JSON.stringify({
          passkey_assertion: { id: 'credential-123' }
        })
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        redirectTo: '/home'
      });
    });

    assert.equal(calls.recaptcha.length, 0);
    assert.equal(calls.password.length, 0);
    assert.deepEqual(calls.passkey, [
      {
        assertion: { id: 'credential-123' },
        cookie: 'auth.sid=auth-session; ethicapp.mng.sid=mng-session',
        language: 'es-CL',
        origin: 'http://localhost'
      }
    ]);
    assert.equal(calls.impersonation.length, 1);
  });

  it('rejects professor impersonation when reCAPTCHA validation fails', async () => {
    const { calls, router } = createImpersonationRouter({
      verifyRecaptchaTokenService: async (payload) => {
        calls.recaptcha.push(payload);
        return false;
      }
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22/impersonate-professor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          admin_password: 'admin-secret',
          recaptcha_token: 'bad-token'
        })
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'Invalid recaptcha token'
      });
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.impersonation.length, 0);
  });

  it('rejects impersonation for non-professor accounts', async () => {
    const { calls, router } = createImpersonationRouter({
      getUserByIdService: async (id) => ({
        id: Number(id),
        role: 'A',
        email: 'student@test'
      })
    });
    const app = createTestApp(router);

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22/impersonate-professor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          admin_password: 'admin-secret',
          recaptcha_token: 'test-recaptcha-token'
        })
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), {
        error: 'Only professor accounts can be impersonated'
      });
    });

    assert.equal(calls.recaptcha.length, 0);
    assert.equal(calls.password.length, 0);
    assert.equal(calls.impersonation.length, 0);
  });
});
