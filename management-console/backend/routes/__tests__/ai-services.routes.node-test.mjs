import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { csrfProtection } from '../../middleware/csrfProtection.js';
import { createSensitiveActionVerifier } from '../../services/sensitive-action.service.js';
import { createAiServicesRouter, normalizeLocale } from '../ai-services.routes.js';

const CSRF_TOKEN = 'test-csrf-token';
const VALID_PASSWORD = 'admin-secret';
const VALID_RECAPTCHA = 'valid-recaptcha';
const VALID_PASSKEY_ID = 'valid-passkey';

// Step-up confirmations accepted by the fake verifier services below.
const PASSWORD_CONFIRMATION = Object.freeze({ admin_password: VALID_PASSWORD, recaptcha_token: VALID_RECAPTCHA });
const PASSKEY_CONFIRMATION = Object.freeze({ passkey_assertion: { id: VALID_PASSKEY_ID, response: {} } });

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

const catalogServices = [
  { id: 'polyadic-agent', name: 'Polyadic agent', usesLlm: true, available: true, adapters: [] },
  { id: 'argumentation-tutor', name: 'Argumentation tutor', usesLlm: true, available: false, adapters: [] }
];

function createFakeStore() {
  const calls = { saveConnection: [], deleteConnection: 0, createPolicyVersion: [] };
  let connection = null;
  const versions = [{ id: 1, allowedServiceIds: [], note: 'Initial', launchedSessionCount: 3 }];

  return {
    calls,
    store: {
      getConnection: async () => connection,
      saveConnection: async (input) => {
        calls.saveConnection.push(input);
        connection = { baseUrl: input.baseUrl, keycloakPublicUrl: input.keycloakPublicUrl, updatedBy: { id: input.userId } };
        return connection;
      },
      deleteConnection: async () => {
        calls.deleteConnection += 1;
        const removed = connection !== null;
        connection = null;
        return removed;
      },
      getPolicyHistory: async () => ({ current: versions[0], versions: [...versions] }),
      createPolicyVersion: async (input) => {
        calls.createPolicyVersion.push(input);
        const version = { id: versions[0].id + 1, ...input, launchedSessionCount: 0 };
        versions.unshift(version);
        return version;
      }
    }
  };
}

// Real verifier over fake auth-backend and reCAPTCHA services. A passkey
// assertion with another id is rejected the way auth-backend does (a 401).
function createFakeVerifier({ passkeys = [] } = {}) {
  const calls = { recaptcha: [], password: [], passkey: [] };

  const verifySensitiveAction = createSensitiveActionVerifier({
    listAdminPasskeysService: async () => ({ passkeys }),
    verifyRecaptchaTokenService: async ({ token }) => {
      calls.recaptcha.push(token);
      return token === VALID_RECAPTCHA;
    },
    verifyAdminPasswordService: async ({ password }) => {
      calls.password.push(password);
      return password === VALID_PASSWORD;
    },
    verifyAdminPasskeyService: async ({ assertion }) => {
      calls.passkey.push(assertion.id);
      if (assertion.id !== VALID_PASSKEY_ID) {
        throw Object.assign(new Error('PASSKEY_AUTHENTICATION_FAILED'), { status: 401 });
      }
      return true;
    }
  });

  return { calls, verifySensitiveAction };
}

function createTestApp({ session = { uid: 7, role: 'S' }, overrides = {}, passkeys = [] } = {}) {
  const fake = createFakeStore();
  const verifier = createFakeVerifier({ passkeys });
  const serviceCalls = { catalog: [], test: [] };
  const app = express();

  app.use(express.json());
  app.use((req, res, next) => {
    req.session = session ? { ...session, csrfToken: CSRF_TOKEN } : {};
    next();
  });
  app.use('/mng/api', csrfProtection);
  app.use(createAiServicesRouter({
    store: fake.store,
    fetchCatalogService: async (payload) => {
      serviceCalls.catalog.push(payload);
      return { ok: true, contractVersion: '1', locale: payload.locale, services: catalogServices };
    },
    testConnectionService: async (payload) => {
      serviceCalls.test.push(payload);
      return { ok: true, error: null, token: { ok: true }, catalog: { ok: true }, serviceCount: 2 };
    },
    verifySensitiveAction: verifier.verifySensitiveAction,
    ...overrides
  }));
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: err.message });
  });

  return { app, calls: fake.calls, serviceCalls, stepUpCalls: verifier.calls };
}

function jsonRequest(method, body, { csrf = true } = {}) {
  return {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': CSRF_TOKEN } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

const ENDPOINTS = [
  ['GET', '/connection', undefined],
  ['PUT', '/connection', { baseUrl: 'https://ai.example.org', ...PASSWORD_CONFIRMATION }],
  ['DELETE', '/connection', { ...PASSWORD_CONFIRMATION }],
  ['POST', '/connection/test', { baseUrl: 'https://ai.example.org' }],
  ['GET', '/catalog', undefined],
  ['GET', '/policy', undefined],
  ['POST', '/policy', { allowedServiceIds: [], ...PASSWORD_CONFIRMATION }]
];

describe('management-console AI services routes', () => {
  describe('authorization', () => {
    for (const role of ['P', 'A']) {
      it(`rejects role ${role} on every endpoint without touching data`, async () => {
        const { app, calls, serviceCalls, stepUpCalls } = createTestApp({ session: { uid: 9, role } });

        await withServer(app, async (baseUrl) => {
          for (const [method, path, body] of ENDPOINTS) {
            const response = await fetch(`${baseUrl}/mng/api/ai-services${path}`, jsonRequest(method, body));
            assert.equal(response.status, 403, `${method} ${path}`);
          }
        });

        assert.equal(calls.saveConnection.length, 0);
        assert.equal(calls.deleteConnection, 0);
        assert.equal(calls.createPolicyVersion.length, 0);
        assert.equal(serviceCalls.catalog.length + serviceCalls.test.length, 0);
        assert.equal(stepUpCalls.recaptcha.length + stepUpCalls.password.length, 0);
      });
    }

    it('redirects unauthenticated requests to login', async () => {
      const { app } = createTestApp({ session: null });

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`, { redirect: 'manual' });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/auth/login');
      });
    });

    it('requires a CSRF token on every write', async () => {
      const { app, calls, serviceCalls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        for (const [method, path, body] of ENDPOINTS.filter(([method]) => method !== 'GET')) {
          const response = await fetch(
            `${baseUrl}/mng/api/ai-services${path}`,
            jsonRequest(method, body, { csrf: false })
          );
          assert.equal(response.status, 403, `${method} ${path}`);
          assert.deepEqual(await response.json(), { error: 'Invalid CSRF token' });
        }
      });

      assert.equal(calls.saveConnection.length, 0);
      assert.equal(calls.deleteConnection, 0);
      assert.equal(calls.createPolicyVersion.length, 0);
      assert.equal(serviceCalls.test.length, 0);
    });
  });

  describe('connection', () => {
    it('reports no connection, saves one with the operator as author, and returns it', async () => {
      const { app, calls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        const empty = await fetch(`${baseUrl}/mng/api/ai-services/connection`);
        assert.deepEqual(await empty.json(), { connection: null });

        const saved = await fetch(`${baseUrl}/mng/api/ai-services/connection`, jsonRequest('PUT', {
          baseUrl: ' https://ai.example.org/ ',
          keycloakPublicUrl: '',
          ...PASSWORD_CONFIRMATION
        }));
        assert.equal(saved.status, 200);
        assert.equal((await saved.json()).connection.baseUrl, 'https://ai.example.org');

        const read = await fetch(`${baseUrl}/mng/api/ai-services/connection`);
        assert.equal((await read.json()).connection.baseUrl, 'https://ai.example.org');
      });

      assert.deepEqual(calls.saveConnection, [{
        baseUrl: 'https://ai.example.org',
        keycloakPublicUrl: null,
        userId: 7
      }]);
    });

    const invalidInputs = [
      [{ baseUrl: 'ftp://ai.example.org' }, 'INVALID_BASE_URL'],
      [{ baseUrl: 'https://user:secret@ai.example.org' }, 'INVALID_BASE_URL'],
      [{ baseUrl: 'https://ai.example.org/#fragment' }, 'INVALID_BASE_URL'],
      [{ baseUrl: '' }, 'INVALID_BASE_URL'],
      [{ baseUrl: 'http:ai.example.org' }, 'INVALID_BASE_URL'],
      [{ baseUrl: 'http:///ai.example.org' }, 'INVALID_BASE_URL'],
      [{ baseUrl: 'https://ai.example.org/base?x=1' }, 'INVALID_BASE_URL'],
      [{ baseUrl: 'https://ai.example.org', keycloakPublicUrl: 'https://ai.example.org/keycloak?x=1' }, 'INVALID_KEYCLOAK_PUBLIC_URL'],
      [{ baseUrl: 'https://ai.example.org', keycloakPublicUrl: 'https:ai.example.org/keycloak' }, 'INVALID_KEYCLOAK_PUBLIC_URL'],
      [{}, 'INVALID_BASE_URL'],
      [{ baseUrl: 'https://ai.example.org', keycloakPublicUrl: 'javascript:alert(1)' }, 'INVALID_KEYCLOAK_PUBLIC_URL'],
      [{ baseUrl: 'https://ai.example.org', keycloakPublicUrl: 'https://kc@ai.example.org' }, 'INVALID_KEYCLOAK_PUBLIC_URL']
    ];

    for (const [body, code] of invalidInputs) {
      it(`rejects ${JSON.stringify(body)} with ${code} before confirming, writing or testing`, async () => {
        const { app, calls, serviceCalls, stepUpCalls } = createTestApp();

        await withServer(app, async (baseUrl) => {
          for (const [method, path] of [['PUT', '/connection'], ['POST', '/connection/test']]) {
            const response = await fetch(
              `${baseUrl}/mng/api/ai-services${path}`,
              jsonRequest(method, { ...body, ...PASSWORD_CONFIRMATION })
            );
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: code });
          }
        });

        assert.equal(calls.saveConnection.length, 0);
        assert.equal(serviceCalls.test.length, 0);
        assert.equal(stepUpCalls.recaptcha.length + stepUpCalls.password.length, 0);
      });
    }

    it('deletes the connection when confirmed', async () => {
      const { app, calls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/mng/api/ai-services/connection`, jsonRequest('PUT', {
          baseUrl: 'http://ai-additions:8080',
          ...PASSWORD_CONFIRMATION
        }));
        const response = await fetch(
          `${baseUrl}/mng/api/ai-services/connection`,
          jsonRequest('DELETE', { ...PASSWORD_CONFIRMATION })
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { removed: true, connection: null });
      });

      assert.equal(calls.deleteConnection, 1);
    });

    it('tests unsaved URLs through ethicapp with the operator identity', async () => {
      const { app, calls, serviceCalls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/connection/test`, {
          ...jsonRequest('POST', { baseUrl: 'http://ai-additions:8080', keycloakPublicUrl: 'https://ai.example.org/keycloak' }),
          headers: {
            ...jsonRequest('POST').headers,
            Cookie: 'ethicapp.mng.sid=abc',
            'Accept-Language': 'es-CL'
          }
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).serviceCount, 2);
      });

      assert.equal(calls.saveConnection.length, 0);
      assert.deepEqual(serviceCalls.test, [{
        baseUrl: 'http://ai-additions:8080',
        keycloakPublicUrl: 'https://ai.example.org/keycloak',
        cookie: 'ethicapp.mng.sid=abc',
        userId: 7,
        userRole: 'S',
        language: 'es-CL'
      }]);
    });
  });

  describe('catalog', () => {
    it('passes a normalized locale to ethicapp', async () => {
      const { app, serviceCalls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/mng/api/ai-services/catalog?locale=es_CL`);
        await fetch(`${baseUrl}/mng/api/ai-services/catalog?locale=fr-FR`);
        await fetch(`${baseUrl}/mng/api/ai-services/catalog`, { headers: { 'Accept-Language': 'es-AR,es;q=0.9' } });
      });

      assert.deepEqual(serviceCalls.catalog.map((call) => call.locale), ['es_CL', 'en_US', 'es_CL']);
    });

    it('returns catalog errors as typed values', async () => {
      const { app } = createTestApp({
        overrides: { fetchCatalogService: async () => ({ ok: false, error: 'unauthorized' }) }
      });

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/catalog`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: false, error: 'unauthorized' });
      });
    });

    it('normalizes locales with the canonical rule', () => {
      assert.equal(normalizeLocale('es'), 'es_CL');
      assert.equal(normalizeLocale('es_ES'), 'es_CL');
      assert.equal(normalizeLocale('ES-mx'), 'es_CL');
      assert.equal(normalizeLocale('es;q=0.9,en;q=0.5'), 'es_CL');
      assert.equal(normalizeLocale('en-GB'), 'en_US');
      assert.equal(normalizeLocale('pt-BR,es;q=0.8'), 'en_US');
      assert.equal(normalizeLocale(undefined), 'en_US');
    });
  });

  describe('policy', () => {
    it('returns the current version and the history', async () => {
      const { app } = createTestApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`);
        const body = await response.json();
        assert.equal(body.current.id, 1);
        assert.equal(body.versions.length, 1);
      });
    });

    it('appends a new version with known ids, the note and the operator as author', async () => {
      const { app, calls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`, jsonRequest('POST', {
          allowedServiceIds: ['polyadic-agent', 'argumentation-tutor', 'polyadic-agent'],
          note: '  Pilot  ',
          ...PASSWORD_CONFIRMATION
        }));
        assert.equal(response.status, 201);
        assert.equal((await response.json()).version.id, 2);

        const history = await (await fetch(`${baseUrl}/mng/api/ai-services/policy`)).json();
        assert.deepEqual(history.versions.map((version) => version.id), [2, 1]);
      });

      assert.deepEqual(calls.createPolicyVersion, [{
        allowedServiceIds: ['polyadic-agent', 'argumentation-tutor'],
        note: 'Pilot',
        userId: 7
      }]);
    });

    it('rejects ids that are not in the live catalog', async () => {
      const { app, calls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`, jsonRequest('POST', {
          allowedServiceIds: ['polyadic-agent', 'made-up-service'],
          ...PASSWORD_CONFIRMATION
        }));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          error: 'UNKNOWN_SERVICE_IDS',
          unknownServiceIds: ['made-up-service']
        });
      });

      assert.equal(calls.createPolicyVersion.length, 0);
    });

    it('rejects a non-empty set when the catalog cannot be read', async () => {
      const { app, calls } = createTestApp({
        overrides: { fetchCatalogService: async () => ({ ok: false, error: 'unreachable' }) }
      });

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`, jsonRequest('POST', {
          allowedServiceIds: ['polyadic-agent'],
          ...PASSWORD_CONFIRMATION
        }));
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: 'CATALOG_UNAVAILABLE', catalogError: 'unreachable' });
      });

      assert.equal(calls.createPolicyVersion.length, 0);
    });

    it('saves an empty set without reading the catalog, so AI can always be turned off', async () => {
      const { app, calls, serviceCalls } = createTestApp({
        overrides: { fetchCatalogService: async () => { throw new Error('must not be called'); } }
      });

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`, jsonRequest('POST', {
          allowedServiceIds: [],
          note: 'Stop AI',
          ...PASSWORD_CONFIRMATION
        }));
        assert.equal(response.status, 201);
      });

      assert.equal(serviceCalls.catalog.length, 0);
      assert.deepEqual(calls.createPolicyVersion, [{ allowedServiceIds: [], note: 'Stop AI', userId: 7 }]);
    });

    const invalidPolicies = [
      [{}, 'INVALID_ALLOWED_SERVICE_IDS'],
      [{ allowedServiceIds: 'polyadic-agent' }, 'INVALID_ALLOWED_SERVICE_IDS'],
      [{ allowedServiceIds: [''] }, 'INVALID_ALLOWED_SERVICE_IDS'],
      [{ allowedServiceIds: [42] }, 'INVALID_ALLOWED_SERVICE_IDS'],
      [{ allowedServiceIds: ['bad id'] }, 'INVALID_ALLOWED_SERVICE_IDS'],
      [{ allowedServiceIds: [], note: 12 }, 'INVALID_NOTE'],
      [{ allowedServiceIds: [], note: 'x'.repeat(1001) }, 'INVALID_NOTE']
    ];

    for (const [body, code] of invalidPolicies) {
      it(`rejects policy input ${JSON.stringify(body).slice(0, 60)} with ${code}`, async () => {
        const { app, calls } = createTestApp();

        await withServer(app, async (baseUrl) => {
          const response = await fetch(
            `${baseUrl}/mng/api/ai-services/policy`,
            jsonRequest('POST', { ...body, ...PASSWORD_CONFIRMATION })
          );
          assert.equal(response.status, 400);
          assert.equal((await response.json()).error, code);
        });

        assert.equal(calls.createPolicyVersion.length, 0);
      });
    }
  });

  describe('step-up confirmation', () => {
    const WRITE_ROUTES = [
      {
        name: 'saving the connection',
        method: 'PUT',
        path: '/connection',
        body: { baseUrl: 'https://ai.example.org' },
        appliedStatus: 200,
        changeCount: (calls) => calls.saveConnection.length
      },
      {
        name: 'removing the connection',
        method: 'DELETE',
        path: '/connection',
        body: {},
        appliedStatus: 200,
        changeCount: (calls) => calls.deleteConnection
      },
      {
        name: 'saving a policy version',
        method: 'POST',
        path: '/policy',
        body: { allowedServiceIds: ['polyadic-agent'], note: 'Pilot' },
        appliedStatus: 201,
        changeCount: (calls) => calls.createPolicyVersion.length
      }
    ];

    async function send(app, route, confirmation) {
      return withServer(app, async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/mng/api/ai-services${route.path}`,
          jsonRequest(route.method, { ...route.body, ...confirmation })
        );
        return { status: response.status, body: await response.json() };
      });
    }

    for (const route of WRITE_ROUTES) {
      describe(route.name, () => {
        it('is refused without a confirmation, even with the former confirm flag', async () => {
          const { app, calls } = createTestApp();

          const response = await send(app, route, { confirm: true });

          assert.equal(response.status, 400);
          assert.deepEqual(response.body, { error: 'Invalid recaptcha token' });
          assert.equal(route.changeCount(calls), 0);
        });

        it('answers 401 PASSKEY_REQUIRED without a confirmation when the administrator has passkeys', async () => {
          const { app, calls } = createTestApp({ passkeys: [{ id: 1 }] });

          const response = await send(app, route, {});

          assert.equal(response.status, 401);
          assert.deepEqual(response.body, { error: 'PASSKEY_REQUIRED' });
          assert.equal(route.changeCount(calls), 0);
        });

        it('refuses the password fallback with 401 PASSKEY_REQUIRED when the administrator has passkeys', async () => {
          const { app, calls, stepUpCalls } = createTestApp({ passkeys: [{ id: 1 }] });

          const response = await send(app, route, PASSWORD_CONFIRMATION);

          assert.equal(response.status, 401);
          assert.deepEqual(response.body, { error: 'PASSKEY_REQUIRED' });
          assert.equal(route.changeCount(calls), 0);
          assert.equal(stepUpCalls.recaptcha.length + stepUpCalls.password.length, 0);
        });

        it('refuses a wrong password with 401', async () => {
          const { app, calls } = createTestApp();

          const response = await send(app, route, { admin_password: 'wrong', recaptcha_token: VALID_RECAPTCHA });

          assert.equal(response.status, 401);
          assert.deepEqual(response.body, { error: 'Invalid administrator password' });
          assert.equal(route.changeCount(calls), 0);
        });

        it('refuses a failed reCAPTCHA with 400 before checking the password', async () => {
          const { app, calls, stepUpCalls } = createTestApp();

          const response = await send(app, route, { admin_password: VALID_PASSWORD, recaptcha_token: 'bad-token' });

          assert.equal(response.status, 400);
          assert.deepEqual(response.body, { error: 'Invalid recaptcha token' });
          assert.equal(route.changeCount(calls), 0);
          assert.equal(stepUpCalls.password.length, 0);
        });

        it('refuses a passkey that auth-backend rejects with 401', async () => {
          const { app, calls } = createTestApp({ passkeys: [{ id: 1 }] });

          const response = await send(app, route, { passkey_assertion: { id: 'other-passkey', response: {} } });

          assert.equal(response.status, 401);
          assert.deepEqual(response.body, { error: 'Invalid administrator passkey' });
          assert.equal(route.changeCount(calls), 0);
        });

        it('applies the change with the right password and reCAPTCHA', async () => {
          const { app, calls, stepUpCalls } = createTestApp();

          const response = await send(app, route, PASSWORD_CONFIRMATION);

          assert.equal(response.status, route.appliedStatus);
          assert.equal(route.changeCount(calls), 1);
          assert.deepEqual(stepUpCalls.recaptcha, [VALID_RECAPTCHA]);
          assert.deepEqual(stepUpCalls.password, [VALID_PASSWORD]);
        });

        it('applies the change with a valid passkey, without reCAPTCHA or password', async () => {
          const { app, calls, stepUpCalls } = createTestApp({ passkeys: [{ id: 1 }] });

          const response = await send(app, route, PASSKEY_CONFIRMATION);

          assert.equal(response.status, route.appliedStatus);
          assert.equal(route.changeCount(calls), 1);
          assert.deepEqual(stepUpCalls.passkey, [VALID_PASSKEY_ID]);
          assert.equal(stepUpCalls.recaptcha.length + stepUpCalls.password.length, 0);
        });
      });
    }

    it('keeps the stored values free of confirmation fields', async () => {
      const { app, calls } = createTestApp();

      await send(app, WRITE_ROUTES[0], PASSWORD_CONFIRMATION);
      await send(app, WRITE_ROUTES[2], PASSWORD_CONFIRMATION);

      assert.deepEqual(calls.saveConnection, [{ baseUrl: 'https://ai.example.org', keycloakPublicUrl: null, userId: 7 }]);
      assert.deepEqual(calls.createPolicyVersion, [{ allowedServiceIds: ['polyadic-agent'], note: 'Pilot', userId: 7 }]);
    });

    it('checks policy ids against the catalog before asking for the confirmation', async () => {
      const { app, calls, stepUpCalls } = createTestApp();

      const response = await send(app, { ...WRITE_ROUTES[2], body: { allowedServiceIds: ['made-up-service'] } }, PASSWORD_CONFIRMATION);

      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'UNKNOWN_SERVICE_IDS');
      assert.equal(calls.createPolicyVersion.length, 0);
      assert.equal(stepUpCalls.recaptcha.length + stepUpCalls.password.length, 0);
    });

    it('does not ask for a confirmation to test a connection', async () => {
      const { app, serviceCalls, stepUpCalls } = createTestApp({ passkeys: [{ id: 1 }] });

      const response = await send(app, { method: 'POST', path: '/connection/test', body: { baseUrl: 'https://ai.example.org' } }, {});

      assert.equal(response.status, 200);
      assert.equal(serviceCalls.test.length, 1);
      assert.equal(stepUpCalls.recaptcha.length + stepUpCalls.passkey.length, 0);
    });
  });
});
