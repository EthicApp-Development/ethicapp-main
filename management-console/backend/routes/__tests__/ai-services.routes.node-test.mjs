import assert from 'node:assert/strict';
import express from 'express';
import { describe, it } from 'node:test';

import { csrfProtection } from '../../middleware/csrfProtection.js';
import { createAiServicesRouter, normalizeLocale } from '../ai-services.routes.js';

const CSRF_TOKEN = 'test-csrf-token';

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

function createTestApp({ session = { uid: 7, role: 'S' }, overrides = {} } = {}) {
  const fake = createFakeStore();
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
    ...overrides
  }));
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    return res.status(500).json({ error: err.message });
  });

  return { app, calls: fake.calls, serviceCalls };
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
  ['PUT', '/connection', { baseUrl: 'https://ai.example.org' }],
  ['DELETE', '/connection', { confirm: true }],
  ['POST', '/connection/test', { baseUrl: 'https://ai.example.org' }],
  ['GET', '/catalog', undefined],
  ['GET', '/policy', undefined],
  ['POST', '/policy', { allowedServiceIds: [] }]
];

describe('management-console AI services routes', () => {
  describe('authorization', () => {
    for (const role of ['P', 'A']) {
      it(`rejects role ${role} on every endpoint without touching data`, async () => {
        const { app, calls, serviceCalls } = createTestApp({ session: { uid: 9, role } });

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
          keycloakPublicUrl: ''
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
      it(`rejects ${JSON.stringify(body)} with ${code} before writing or testing`, async () => {
        const { app, calls, serviceCalls } = createTestApp();

        await withServer(app, async (baseUrl) => {
          for (const [method, path] of [['PUT', '/connection'], ['POST', '/connection/test']]) {
            const response = await fetch(`${baseUrl}/mng/api/ai-services${path}`, jsonRequest(method, body));
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: code });
          }
        });

        assert.equal(calls.saveConnection.length, 0);
        assert.equal(serviceCalls.test.length, 0);
      });
    }

    it('refuses to delete the connection without explicit confirmation', async () => {
      const { app, calls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        for (const body of [undefined, {}, { confirm: 'true' }, { confirm: false }]) {
          const response = await fetch(`${baseUrl}/mng/api/ai-services/connection`, jsonRequest('DELETE', body));
          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), { error: 'CONFIRMATION_REQUIRED' });
        }
      });

      assert.equal(calls.deleteConnection, 0);
    });

    it('deletes the connection when confirmed', async () => {
      const { app, calls } = createTestApp();

      await withServer(app, async (baseUrl) => {
        await fetch(`${baseUrl}/mng/api/ai-services/connection`, jsonRequest('PUT', { baseUrl: 'http://ai-additions:8080' }));
        const response = await fetch(`${baseUrl}/mng/api/ai-services/connection`, jsonRequest('DELETE', { confirm: true }));
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
          note: '  Pilot  '
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
          allowedServiceIds: ['polyadic-agent', 'made-up-service']
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
          allowedServiceIds: ['polyadic-agent']
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
          note: 'Stop AI'
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
          const response = await fetch(`${baseUrl}/mng/api/ai-services/policy`, jsonRequest('POST', body));
          assert.equal(response.status, 400);
          assert.equal((await response.json()).error, code);
        });

        assert.equal(calls.createPolicyVersion.length, 0);
      });
    }
  });
});
