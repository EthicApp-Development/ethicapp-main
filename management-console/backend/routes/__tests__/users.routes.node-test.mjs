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

describe('management-console user routes', () => {
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
