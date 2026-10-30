import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { createUserForgettingRouter } from '../user-forgetting.routes.js';
import { createSensitiveActionVerifier } from '../../services/sensitive-action.service.js';

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
    return res.status(500).json({ error: err.message });
  });
  return app;
}

function requireRoleS(req, res, next) {
  return req.session.role === 'S' ? next() : res.status(403).json({ error: 'Forbidden' });
}

const PENDING_REQUESTS = Object.freeze([
  { serviceId: 'argumentation-tutor', status: 'done', attempts: 1, lastError: null },
  { serviceId: 'polyadic-agent', status: 'pending', attempts: 2, lastError: 'HTTP_503' }
]);

function createRouter(overrides = {}) {
  const calls = { password: [], recaptcha: [], forget: [], fetch: [], retry: [], audit: [] };
  const router = createUserForgettingRouter({
    requireManagementRoleMiddleware: requireRoleS,
    verifySensitiveAction: createSensitiveActionVerifier({
      verifyRecaptchaTokenService: async (payload) => {
        calls.recaptcha.push(payload);
        return true;
      },
      listAdminPasskeysService: async () => ({ passkeys: [] }),
      verifyAdminPasswordService: async (payload) => {
        calls.password.push(payload);
        return payload.password === 'admin-secret';
      },
      verifyAdminPasskeyService: async () => true
    }),
    forgetStudentService: async (payload) => {
      calls.forget.push(payload);
      return { id: payload.userId, status: 'anonymized', runId: 91, erasureRequests: [] };
    },
    fetchErasureRequestsService: async (payload) => {
      calls.fetch.push(payload);
      return { ok: true, requests: PENDING_REQUESTS };
    },
    retryErasureRequestsService: async (payload) => {
      calls.retry.push(payload);
      return { ok: true, requests: PENDING_REQUESTS };
    },
    recordAuditEvent: async (event) => {
      calls.audit.push(event);
      return { id: 1 };
    },
    ...overrides
  });
  return { calls, router };
}

function post(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'auth.sid=auth-session' },
    body: JSON.stringify(body)
  });
}

function forgettingError(code) {
  return Object.assign(new Error(code), { code });
}

describe('POST /mng/api/users/:id/forget', () => {
  it('forgets the student after the step-up confirmation, as the signed-in administrator', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/forget', {
        expected_email: 'student@example.test',
        admin_password: 'admin-secret',
        recaptcha_token: 'token'
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: 22, status: 'anonymized', runId: 91, erasureRequests: [] });
    });

    assert.equal(calls.recaptcha.length, 1);
    assert.deepEqual(calls.forget, [{ adminUserId: 7, userId: 22, expectedEmail: 'student@example.test' }]);
  });

  it('does not forget anyone when the step-up confirmation fails', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/forget', {
        expected_email: 'student@example.test',
        admin_password: 'wrong',
        recaptcha_token: 'token'
      });

      assert.equal(response.status, 401);
    });

    assert.deepEqual(calls.forget, []);
  });

  it('rejects an invalid id or expected email before the step-up confirmation', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      let response = await post(baseUrl, '/mng/api/users/abc/forget', { admin_password: 'admin-secret' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'INVALID_USER_ID' });

      response = await post(baseUrl, '/mng/api/users/22/forget', { expected_email: 42 });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'INVALID_EXPECTED_EMAIL' });
    });

    assert.deepEqual(calls.password, []);
    assert.deepEqual(calls.forget, []);
  });

  for (const [code, status] of [
    ['ACCOUNT_ANONYMIZED', 409],
    ['NOT_A_STUDENT', 409],
    ['ACCOUNT_CHANGED', 409],
    ['USER_NOT_FOUND', 404]
  ]) {
    it(`answers ${status} ${code}`, async () => {
      const { router } = createRouter({
        forgetStudentService: async () => {
          throw forgettingError(code);
        }
      });

      await withServer(createTestApp(router), async (baseUrl) => {
        const response = await post(baseUrl, '/mng/api/users/22/forget', {
          expected_email: 'student@example.test',
          admin_password: 'admin-secret',
          recaptcha_token: 'token'
        });

        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { error: code });
      });
    });
  }

  it('is reserved to super administrators', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router, { uid: 9, role: 'P' }), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/forget', { admin_password: 'admin-secret' });
      assert.equal(response.status, 403);
    });

    assert.deepEqual(calls.forget, []);
  });
});

describe('erasure requests', () => {
  it('reads the status from ethicapp with the operator identity', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/22/erasure-requests`, {
        headers: { Cookie: 'auth.sid=auth-session', 'Accept-Language': 'es-CL' }
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, requests: PENDING_REQUESTS });
    });

    assert.deepEqual(calls.fetch, [{
      targetUserId: 22,
      cookie: 'auth.sid=auth-session',
      userId: 7,
      userRole: 'S',
      language: 'es-CL'
    }]);
  });

  it('retries through ethicapp and records the retry', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/erasure-requests/retry', {});
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    });

    assert.equal(calls.retry.length, 1);
    assert.deepEqual(calls.audit, [{
      adminUserId: 7,
      action: 'account.erasure_retry',
      targetUserId: 22,
      outcome: 'succeeded',
      reasonCode: null
    }]);
  });

  it('records a retry ethicapp could not take as failed', async () => {
    const { calls, router } = createRouter({
      retryErasureRequestsService: async () => ({ ok: false, error: 'unreachable' })
    });

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await post(baseUrl, '/mng/api/users/22/erasure-requests/retry', {});
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: false, error: 'unreachable' });
    });

    assert.deepEqual(calls.audit.map((event) => [event.outcome, event.reasonCode]), [
      ['failed', 'ETHICAPP_UNREACHABLE']
    ]);
  });

  it('rejects an invalid id', async () => {
    const { calls, router } = createRouter();

    await withServer(createTestApp(router), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mng/api/users/0/erasure-requests`);
      assert.equal(response.status, 400);
    });

    assert.deepEqual(calls.fetch, []);
  });
});
