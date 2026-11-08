import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createUserAccountRouter } from '../user-account.routes.js';
import { recordAdminAuditEventBestEffort } from '../../services/admin-audit.service.js';
import { createUserAccountWithAuthBackend } from '../../services/authBackend.service.js';
import { createSensitiveActionVerifier } from '../../services/sensitive-action.service.js';

const PASSWORD = 'Temporary-Pass!42';
const EMAIL = 'ana.rojas@example.test';

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

const CREATED = Object.freeze({
  ok: true,
  status: 201,
  id: 314,
  message: 'Account created. The user was sent a welcome email without the password',
  welcomeEmailSent: true
});

// The audit rows go through the real helper, which validates the action,
// the outcome, the role and the reason code, into a fake executor.
function createRouter({ createAccount, passkeys = [], listPasskeys } = {}) {
  const calls = { password: [], createAccount: [], auditParams: [], logs: [] };
  const executor = {
    async query(text, params) {
      calls.auditParams.push(params);
      return { rows: [{ id: calls.auditParams.length, occurred_at: new Date() }] };
    }
  };
  const logger = { error: (...args) => calls.logs.push(JSON.stringify(args)) };
  const router = createUserAccountRouter({
    requireManagementRoleMiddleware: requireRoleS,
    verifySensitiveAction: createSensitiveActionVerifier({
      verifyRecaptchaTokenService: async () => true,
      listAdminPasskeysService: listPasskeys || (async () => ({ passkeys })),
      verifyAdminPasswordService: async (payload) => {
        calls.password.push(payload);
        return payload.password === 'admin-secret';
      },
      verifyAdminPasskeyService: async () => true
    }),
    createUserAccountService: async (payload) => {
      calls.createAccount.push(payload);
      return createAccount ? createAccount(payload) : CREATED;
    },
    recordAuditEvent: (event) => recordAdminAuditEventBestEffort(executor, event, logger),
    logger
  });
  return { calls, router };
}

function validBody(overrides = {}) {
  return {
    firstname: 'Ana',
    lastname: 'Rojas',
    gender: 'F',
    email: EMAIL,
    role: 'P',
    preferred_locale: 'es_CL',
    password: PASSWORD,
    password_confirmation: PASSWORD,
    privacy_notice_confirmed: true,
    admin_password: 'admin-secret',
    recaptcha_token: 'token',
    ...overrides
  };
}

function post(baseUrl, body) {
  return fetch(`${baseUrl}/mng/api/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'auth.sid=auth-session',
      'Accept-Language': 'es-CL'
    },
    body: JSON.stringify(body)
  });
}

// Neither the password nor the account's identity reaches the audit rows or
// the logs.
function assertNothingSensitiveIn(calls, text = '') {
  for (const value of [JSON.stringify(calls.auditParams), JSON.stringify(calls.logs)]) {
    for (const secret of [PASSWORD, EMAIL, 'Rojas']) {
      assert.ok(!value.includes(secret), `${secret} must not appear`);
    }
  }
  assert.ok(!text.includes(PASSWORD), 'the password must not appear in the response');
}

describe('POST /mng/api/users (#1170)', () => {
  it('creates the account after the step-up, forwarding only the account fields, and audits the success', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, validBody());
      const text = await response.text();

      assert.equal(response.status, 201);
      assert.deepEqual(JSON.parse(text), {
        id: 314,
        message: 'Account created. The user was sent a welcome email without the password',
        welcome_email_sent: true
      });
      assertNothingSensitiveIn(calls, text);
    });

    assert.equal(calls.password.length, 1);
    assert.deepEqual(calls.createAccount, [{
      account: {
        firstname: 'Ana',
        lastname: 'Rojas',
        gender: 'F',
        email: EMAIL,
        role: 'P',
        preferred_locale: 'es_CL',
        password: PASSWORD,
        password_confirmation: PASSWORD
      },
      cookie: 'auth.sid=auth-session',
      language: 'es-CL'
    }]);
    assert.deepEqual(calls.auditParams, [[7, 'account.create', 314, 'succeeded', null, 'P']]);
  });

  it('records a welcome email that could not be sent on the success row', async () => {
    const { calls, router } = createRouter({
      createAccount: () => ({ ...CREATED, message: 'Account created, but the welcome email could not be sent', welcomeEmailSent: false })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, validBody({ role: 'a' }));

      assert.equal(response.status, 201);
      assert.equal((await response.json()).welcome_email_sent, false);
    });

    assert.deepEqual(calls.auditParams, [[7, 'account.create', 314, 'succeeded', 'WELCOME_EMAIL_FAILED', 'A']]);
  });

  for (const [label, value] of [['missing', undefined], ['false', false], ['the string "true"', 'true']]) {
    it(`refuses a privacy notice confirmation that is ${label}, before the step-up, and audits it`, async () => {
      const { calls, router } = createRouter();

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, validBody({ privacy_notice_confirmed: value }));

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: 'PRIVACY_NOTICE_NOT_CONFIRMED' });
      });

      assert.equal(calls.password.length, 0);
      assert.equal(calls.createAccount.length, 0);
      assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'refused', 'PRIVACY_NOTICE_NOT_CONFIRMED', 'P']]);
    });
  }

  it('refuses a wrong step-up without calling auth-backend, and audits it', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, validBody({ admin_password: 'wrong' }));

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Invalid administrator password' });
    });

    assert.equal(calls.createAccount.length, 0);
    assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'refused', 'STEP_UP_REFUSED', 'P']]);
    assertNothingSensitiveIn(calls);
  });

  it('requires the passkey of an administrator who has one', async () => {
    const { calls, router } = createRouter({ passkeys: [{ id: 1 }] });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, validBody());

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'PASSKEY_REQUIRED' });
    });

    assert.equal(calls.createAccount.length, 0);
    assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'refused', 'STEP_UP_REFUSED', 'P']]);
  });

  it('refuses a non-administrator session before anything else', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router, { uid: 9, role: 'P' }), async (baseUrl) => {
      const response = await post(baseUrl, validBody());
      assert.equal(response.status, 403);
    });

    assert.equal(calls.password.length, 0);
    assert.equal(calls.createAccount.length, 0);
    assert.equal(calls.auditParams.length, 0);
  });

  for (const [status, code] of [
    [409, 'EMAIL_ALREADY_REGISTERED'],
    [400, 'WEAK_PASSWORD'],
    [400, 'INVALID_EMAIL'],
    [400, 'INVALID_ROLE']
  ]) {
    it(`passes auth-backend's ${status} ${code} through and audits it as refused`, async () => {
      const { calls, router } = createRouter({
        createAccount: () => ({ ok: false, status, code, message: 'localized text' })
      });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, validBody({ role: code === 'INVALID_ROLE' ? 'S' : 'P' }));

        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: code, message: 'localized text' });
      });

      const role = code === 'INVALID_ROLE' ? null : 'P';
      assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'refused', code, role]]);
      assertNothingSensitiveIn(calls);
    });
  }

  for (const [label, result, reason] of [
    ['an access refusal', { ok: false, status: 403, code: 'INTERNAL_SERVICE_TOKEN_REQUIRED', message: '' }, 'INTERNAL_SERVICE_TOKEN_REQUIRED'],
    ['a server error', { ok: false, status: 500, code: 'INTERNAL_ERROR', message: '' }, 'INTERNAL_ERROR'],
    ['a refusal without a code', { ok: false, status: 400, code: null, message: '' }, 'AUTH_BACKEND_ERROR'],
    ['a success without an id', { ok: false, status: 201, id: Number.NaN, message: '' }, 'AUTH_BACKEND_ERROR']
  ]) {
    it(`answers 502 for ${label} of auth-backend and audits it as failed`, async () => {
      const { calls, router } = createRouter({ createAccount: () => result });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, validBody());

        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: 'AUTH_BACKEND_ERROR' });
      });

      assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'failed', reason, 'P']]);
      assertNothingSensitiveIn(calls);
    });
  }

  it('answers 502 when auth-backend cannot be reached, and audits it as failed', async () => {
    const { calls, router } = createRouter({
      createAccount: () => {
        throw new Error('connect ECONNREFUSED');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, validBody());

      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: 'AUTH_BACKEND_UNAVAILABLE' });
    });

    assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'failed', 'AUTH_BACKEND_UNREACHABLE', 'P']]);
    assertNothingSensitiveIn(calls);
  });

  it('audits a step-up check that fails as failed, and answers 500', async () => {
    const { calls, router } = createRouter({
      listPasskeys: async () => {
        throw new Error('auth-backend unavailable');
      }
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, validBody());
      assert.equal(response.status, 500);
    });

    assert.equal(calls.createAccount.length, 0);
    assert.deepEqual(calls.auditParams, [[7, 'account.create', null, 'failed', 'UNEXPECTED_ERROR', 'P']]);
  });
});

describe('createUserAccountWithAuthBackend (#1170)', () => {
  function fakeFetch(status, body) {
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
      };
    };
    return { requests, fetchImpl };
  }

  const account = {
    firstname: 'Ana',
    lastname: 'Rojas',
    gender: 'F',
    email: EMAIL,
    role: 'P',
    preferred_locale: 'es_CL',
    password: PASSWORD,
    password_confirmation: PASSWORD
  };

  it('posts the account to the internal route with the token, cookie and language', async () => {
    const { requests, fetchImpl } = fakeFetch(201, { id: 314, message: 'created', welcome_email_sent: true });

    const result = await createUserAccountWithAuthBackend({
      account: { ...account, admin_password: 'admin-secret' },
      cookie: 'auth.sid=abc',
      language: 'es-CL',
      fetchImpl
    });

    assert.deepEqual(result, { ok: true, status: 201, id: 314, message: 'created', welcomeEmailSent: true });
    assert.equal(requests.length, 1);
    const [{ url, options }] = requests;
    assert.match(url, /\/api\/auth\/admin\/users$/);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Cookie, 'auth.sid=abc');
    assert.equal(options.headers['Accept-Language'], 'es-CL');
    assert.ok(options.headers['X-Internal-Service-Token']);
    assert.deepEqual(JSON.parse(options.body), account);
  });

  it('reports a refusal with its status, code and message', async () => {
    const { fetchImpl } = fakeFetch(409, { error: 'Ya existe', code: 'EMAIL_ALREADY_REGISTERED' });

    const result = await createUserAccountWithAuthBackend({ account, fetchImpl });

    assert.deepEqual(result, { ok: false, status: 409, code: 'EMAIL_ALREADY_REGISTERED', message: 'Ya existe' });
  });

  it('reads a missing welcome flag as not sent, and a missing id as a failure', async () => {
    const withoutFlag = await createUserAccountWithAuthBackend({
      account,
      fetchImpl: fakeFetch(201, { id: 5 }).fetchImpl
    });
    const withoutId = await createUserAccountWithAuthBackend({
      account,
      fetchImpl: fakeFetch(201, { message: 'created' }).fetchImpl
    });

    assert.equal(withoutFlag.ok, true);
    assert.equal(withoutFlag.welcomeEmailSent, false);
    assert.equal(withoutId.ok, false);
  });
});
