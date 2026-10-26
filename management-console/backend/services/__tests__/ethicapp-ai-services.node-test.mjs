import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  fetchAiServicesCatalogFromEthicapp,
  testAiAdditionsConnectionInEthicapp
} from '../ethicapp.service.js';

const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.secret-access-token';
const IDENTITY = { cookie: 'ethicapp.mng.sid=abc', userId: 7, userRole: 'S', language: 'es-CL' };

function jsonResponse(status, body) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchImpl };
}

// Captures everything written through console.* during a test.
let logged;
const originalConsole = {};
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originalConsole[level] = console[level];
    console[level] = (...args) => logged.push(args.map(String).join(' '));
  }
});
afterEach(() => {
  Object.assign(console, originalConsole);
});

const catalogBody = {
  ok: true,
  contractVersion: '1',
  locale: 'es_CL',
  accessToken: SECRET_TOKEN,
  services: [{
    id: 'polyadic-agent',
    name: 'Agente poliádico',
    description: 'Participa en la discusión',
    usesLlm: true,
    status: 'active',
    available: true,
    descriptorPath: '/polyadic-agent/api/capabilities',
    adapters: [{ id: 'polyadic-agents', description: 'Agentes en el chat', requires: ['polyadic-agent'] }]
  }]
};

describe('ethicapp AI services catalog client', () => {
  it('calls the internal catalog route with the operator identity and returns sanitized services', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, catalogBody));

    const result = await fetchAiServicesCatalogFromEthicapp({ locale: 'es_CL', ...IDENTITY, fetchImpl });

    assert.deepEqual(result, {
      ok: true,
      contractVersion: '1',
      locale: 'es_CL',
      services: [{
        id: 'polyadic-agent',
        name: 'Agente poliádico',
        description: 'Participa en la discusión',
        usesLlm: true,
        status: 'active',
        available: true,
        adapters: [{ id: 'polyadic-agents', description: 'Agentes en el chat' }]
      }]
    });
    assert.equal(calls[0].url, 'http://ethicapp:8501/api/admin/ai-services/catalog?locale=es_CL');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.deepEqual(
      [calls[0].init.headers.Cookie, calls[0].init.headers['X-User-Id'], calls[0].init.headers['X-User-Role']],
      ['ethicapp.mng.sid=abc', '7', 'S']
    );
    assert.ok(!JSON.stringify(result).includes(SECRET_TOKEN));
  });

  for (const code of ['not_configured', 'unreachable', 'unauthorized', 'invalid_response']) {
    it(`passes through the ${code} error from ethicapp`, async () => {
      for (const status of [200, 502, 503]) {
        const { fetchImpl } = fakeFetch(() => jsonResponse(status, { ok: false, error: code, detail: SECRET_TOKEN }));
        const result = await fetchAiServicesCatalogFromEthicapp({ locale: 'en_US', ...IDENTITY, fetchImpl });
        assert.deepEqual(result, { ok: false, error: code });
      }
    });
  }

  it('maps transport failures and timeouts to unreachable', async () => {
    const refused = fakeFetch(() => { throw new TypeError('fetch failed'); });
    assert.deepEqual(
      await fetchAiServicesCatalogFromEthicapp({ ...IDENTITY, fetchImpl: refused.fetchImpl }),
      { ok: false, error: 'unreachable' }
    );

    const hanging = fakeFetch((url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    }));
    assert.deepEqual(
      await fetchAiServicesCatalogFromEthicapp({ ...IDENTITY, fetchImpl: hanging.fetchImpl, timeoutMs: 10 }),
      { ok: false, error: 'unreachable' }
    );
  });

  it('maps a malformed successful body to invalid_response', async () => {
    for (const body of ['not json', { ok: true }, { ok: true, services: [{ name: 'no id' }] }, { ok: false, error: 'other' }]) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(200, body));
      assert.deepEqual(
        await fetchAiServicesCatalogFromEthicapp({ ...IDENTITY, fetchImpl }),
        { ok: false, error: 'invalid_response' },
        JSON.stringify(body)
      );
    }
  });

  it('maps ethicapp failures without a known code to ethicapp_error', async () => {
    for (const [status, body] of [[404, 'Not Found'], [403, { error: 'Forbidden' }], [500, { error: 'Internal server error' }]]) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(status, body));
      assert.deepEqual(
        await fetchAiServicesCatalogFromEthicapp({ ...IDENTITY, fetchImpl }),
        { ok: false, error: 'ethicapp_error' }
      );
    }
  });

  it('logs nothing, including tokens or response bodies', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(502, { ok: false, error: 'unauthorized', accessToken: SECRET_TOKEN }));
    await fetchAiServicesCatalogFromEthicapp({ ...IDENTITY, fetchImpl });
    assert.deepEqual(logged, []);
  });
});

describe('ethicapp AI Additions connection test client', () => {
  it('posts the unsaved URLs and returns each step with the service count', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: true,
      token: { ok: true, accessToken: SECRET_TOKEN },
      catalog: { ok: true },
      serviceCount: 3
    }));

    const result = await testAiAdditionsConnectionInEthicapp({
      baseUrl: 'http://ai-additions:8080',
      keycloakPublicUrl: 'https://ai.example.org/keycloak',
      ...IDENTITY,
      fetchImpl
    });

    assert.deepEqual(result, {
      ok: true,
      error: null,
      token: { ok: true, error: null, skipped: false },
      catalog: { ok: true, error: null, skipped: false },
      serviceCount: 3
    });
    assert.equal(calls[0].url, 'http://ethicapp:8501/api/admin/ai-services/connection-test');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      baseUrl: 'http://ai-additions:8080',
      keycloakPublicUrl: 'https://ai.example.org/keycloak'
    });
    assert.equal(calls[0].init.headers['X-User-Role'], 'S');
    assert.ok(!JSON.stringify(result).includes(SECRET_TOKEN));
  });

  it('omits an unset keycloak URL from the request', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, { ok: true, token: { ok: true }, catalog: { ok: true }, serviceCount: 0 }));
    await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://ai-additions:8080', keycloakPublicUrl: null, ...IDENTITY, fetchImpl });
    assert.deepEqual(JSON.parse(calls[0].init.body), { baseUrl: 'http://ai-additions:8080' });
  });

  for (const code of ['unreachable', 'unauthorized', 'invalid_response']) {
    it(`reports a failed token step (${code}) with the catalog skipped`, async () => {
      const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
        ok: false,
        token: { ok: false, error: code, reason: SECRET_TOKEN },
        catalog: { ok: false, skipped: true }
      }));

      assert.deepEqual(await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl }), {
        ok: false,
        error: code,
        token: { ok: false, error: code, skipped: false },
        catalog: { ok: false, error: null, skipped: true },
        serviceCount: null
      });
    });
  }

  it('reports a failed catalog step after a working token step', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(502, {
      ok: false,
      token: { ok: true },
      catalog: { ok: false, error: 'invalid_response' },
      serviceCount: 5
    }));

    assert.deepEqual(await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl }), {
      ok: false,
      error: 'invalid_response',
      token: { ok: true, error: null, skipped: false },
      catalog: { ok: false, error: 'invalid_response', skipped: false },
      serviceCount: null
    });
  });

  it('maps an unknown step error code to invalid_response', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      token: { ok: false, error: 'something_new' },
      catalog: { ok: false, skipped: true }
    }));
    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
    assert.equal(result.token.error, 'invalid_response');
  });

  it('maps transport failures to unreachable and ethicapp failures to ethicapp_error', async () => {
    const refused = fakeFetch(() => { throw new TypeError('fetch failed'); });
    const unreachable = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl: refused.fetchImpl });
    assert.equal(unreachable.error, 'unreachable');
    assert.equal(unreachable.token.skipped, true);
    assert.equal(unreachable.catalog.skipped, true);

    const missing = fakeFetch(() => jsonResponse(404, 'Not Found'));
    const ethicappError = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl: missing.fetchImpl });
    assert.equal(ethicappError.error, 'ethicapp_error');

    const garbled = fakeFetch(() => jsonResponse(200, { ok: true }));
    const invalid = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl: garbled.fetchImpl });
    assert.equal(invalid.error, 'invalid_response');
  });

  it('logs nothing, including tokens or response bodies', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: false,
      token: { ok: false, error: 'unauthorized', clientSecret: SECRET_TOKEN },
      catalog: { ok: false, skipped: true }
    }));
    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
    assert.deepEqual(logged, []);
    assert.ok(!JSON.stringify(result).includes(SECRET_TOKEN));
  });
});
