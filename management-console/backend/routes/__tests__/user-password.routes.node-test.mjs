import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createUserPasswordRouter } from '../user-password.routes.js';
import { recordAdminAuditEventBestEffort } from '../../services/admin-audit.service.js';
import { createSensitiveActionVerifier } from '../../services/sensitive-action.service.js';

const NEW_PASSWORD = 'Temporary-Pass!42';
const TARGET_EMAIL = 'ana.student@example.test';

async function withServer(app, callback) {
  const server = app.listen(0, '127.0.0.1');

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createTestApp(router, session = { uid: 7, role: 'S' }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session;
    next();
  });
  app.use(router);
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

function requireRoleS(req, res, next) {
  return req.session.role === 'S' ? next() : res.status(403).json({ error: 'Forbidden' });
}

// The audit rows go through the real helper, which validates the action,
// the outcome and the reason code, into a fake executor.
function createRouter({ setPassword, passkeys = [], listPasskeys } = {}) {
  const calls = { password: [], recaptcha: [], setPassword: [], auditParams: [], logs: [] };
  const executor = {
    async query(text, params) {
      calls.auditParams.push(params);
      return { rows: [{ id: calls.auditParams.length, occurred_at: new Date() }] };
    }
  };
  const logger = { error: (...args) => calls.logs.push(JSON.stringify(args)) };
  const router = createUserPasswordRouter({
    requireManagementRoleMiddleware: requireRoleS,
    verifySensitiveAction: createSensitiveActionVerifier({
      verifyRecaptchaTokenService: async (payload) => {
        calls.recaptcha.push(payload);
        return true;
      },
      listAdminPasskeysService: listPasskeys || (async () => ({ passkeys })),
      verifyAdminPasswordService: async (payload) => {
        calls.password.push(payload);
        return payload.password === 'admin-secret';
      },
      verifyAdminPasskeyService: async () => true
    }),
    setUserPasswordService: async (payload) => {
      calls.setPassword.push(payload);
      return setPassword
        ? setPassword(payload)
        : { ok: true, message: "Password set. The user's open sessions were closed" };
    },
    recordAuditEvent: (event) => recordAdminAuditEventBestEffort(executor, event, logger),
    logger
  });
  return { calls, router };
}

function validBody(overrides = {}) {
  return {
    new_password: NEW_PASSWORD,
    password_confirmation: NEW_PASSWORD,
    expected_email: TARGET_EMAIL,
    admin_password: 'admin-secret',
    recaptcha_token: 'token',
    ...overrides
  };
}

function post(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'auth.sid=auth-session',
      'Accept-Language': 'es-CL'
    },
    body: JSON.stringify(body)
  });
}

function assertNoPasswordIn(calls, text = '') {
  for (const value of [text, JSON.stringify(calls.auditParams), JSON.stringify(calls.logs)]) {
    assert.ok(!value.includes(NEW_PASSWORD), 'the password must not appear');
  }
}

describe('POST /mng/api/users/:id/password (#889)', () => {
  it('sets the password after the step-up and audits the success', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/password', validBody());
      const text = await response.text();

      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(text), { id: 22, message: "Password set. The user's open sessions were closed" });
      assertNoPasswordIn(calls, text);
    });

    assert.equal(calls.password.length, 1);
    assert.deepEqual(calls.setPassword, [{
      userId: 22,
      newPassword: NEW_PASSWORD,
      passwordConfirmation: NEW_PASSWORD,
      expectedEmail: TARGET_EMAIL,
      cookie: 'auth.sid=auth-session',
      language: 'es-CL'
    }]);
    assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'succeeded', null]]);
  });

  it('refuses a wrong step-up without calling auth-backend, and audits it', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/password', validBody({ admin_password: 'wrong' }));

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Invalid administrator password' });
    });

    assert.equal(calls.setPassword.length, 0);
    assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'refused', 'STEP_UP_REFUSED']]);
    assertNoPasswordIn(calls);
  });

  it('requires the passkey of an administrator who has one', async () => {
    const { calls, router } = createRouter({ passkeys: [{ id: 1 }] });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/password', validBody());

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'PASSKEY_REQUIRED' });
    });

    assert.equal(calls.setPassword.length, 0);
    assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'refused', 'STEP_UP_REFUSED']]);
  });

  it('refuses a non-administrator session before anything else', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router, { uid: 9, role: 'P' }), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/password', validBody());
      assert.equal(response.status, 403);
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.setPassword.length, 0);
    assert.equal(calls.auditParams.length, 0);
  });

  for (const [label, path, body, code] of [
    ['an invalid user id', '/mng/api/users/abc/password', validBody(), 'INVALID_USER_ID'],
    ['a non-string expected email', '/mng/api/users/22/password', validBody({ expected_email: 5 }), 'INVALID_EXPECTED_EMAIL']
  ]) {
    it(`refuses ${label} before the step-up`, async () => {
      const { calls, router } = createRouter();

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, path, body);

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: code });
      });

      assert.equal(calls.password.length, 0);
      assert.equal(calls.setPassword.length, 0);
    });
  }

  for (const [status, code, message] of [
    [400, 'WEAK_PASSWORD', 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos'],
    [400, 'PASSWORDS_DO_NOT_MATCH', 'Las contraseñas no coinciden'],
    [400, 'REQUIRED_FIELDS_MISSING', 'Faltan campos obligatorios'],
    [409, 'ACCOUNT_CHANGED', 'La cuenta cambió desde que se cargó. Recárgala e intenta nuevamente'],
    [409, 'ACCOUNT_ANONYMIZED', 'Esta cuenta fue anonimizada y no puede iniciar sesión'],
    [409, 'ROLE_NOT_ALLOWED', 'Solo se puede establecer la contraseña de cuentas de estudiantes y profesores'],
    [409, 'OWN_ACCOUNT', 'Cambia tu propia contraseña desde tu perfil, que pide tu contraseña actual'],
    [404, 'USER_NOT_FOUND', 'Usuario no encontrado']
  ]) {
    it(`passes auth-backend's ${code} refusal through and audits it`, async () => {
      const { calls, router } = createRouter({
        setPassword: async () => ({ ok: false, status, code, message })
      });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, '/mng/api/users/22/password', validBody());
        const text = await response.text();

        assert.equal(response.status, status);
        assert.deepEqual(JSON.parse(text), { error: code, message });
        assertNoPasswordIn(calls, text);
      });

      assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'refused', code]]);
    });
  }

  for (const [label, result, reason] of [
    ['a refused internal service token', { ok: false, status: 403, code: 'INTERNAL_SERVICE_TOKEN_REQUIRED', message: 'No autorizado' }, 'INTERNAL_SERVICE_TOKEN_REQUIRED'],
    ['a server error', { ok: false, status: 500, code: 'INTERNAL_ERROR', message: 'Error interno del servidor' }, 'INTERNAL_ERROR'],
    ['a response without a code', { ok: false, status: 503, code: null, message: '' }, 'AUTH_BACKEND_ERROR'],
    ['a code that is not a valid reason code', { ok: false, status: 409, code: 'not a code', message: '' }, 'AUTH_BACKEND_ERROR']
  ]) {
    it(`answers 502 to ${label} and audits a failure`, async () => {
      const { calls, router } = createRouter({ setPassword: async () => result });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, '/mng/api/users/22/password', validBody());

        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: 'AUTH_BACKEND_ERROR' });
      });

      assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'failed', reason]]);
      assertNoPasswordIn(calls);
    });
  }

  it('answers 502 when auth-backend cannot be reached, without logging the password', async () => {
    const { calls, router } = createRouter({
      setPassword: async () => {
        throw new TypeError('fetch failed');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/password', validBody());

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'AUTH_BACKEND_UNAVAILABLE' });
    });

    assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'failed', 'AUTH_BACKEND_UNREACHABLE']]);
    assert.equal(calls.logs.length, 1);
    assertNoPasswordIn(calls);
  });

  it('audits a failure of the step-up check itself', async () => {
    const { calls, router } = createRouter({
      listPasskeys: async () => {
        throw new Error('auth-backend down');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/password', validBody());
      assert.equal(response.status, 500);
    });

    assert.equal(calls.setPassword.length, 0);
    assert.deepEqual(calls.auditParams, [[7, 'account.password_set', 22, 'failed', 'UNEXPECTED_ERROR']]);
  });
});
