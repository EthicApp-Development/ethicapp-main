import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  fetchAiServicesCatalogFromEthicapp,
  testAiAdditionsConnectionInEthicapp
} from '../ethicapp.service.js';

const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.secret-access-token';
const ISSUER = 'https://ai.example.org/keycloak/realms/ethicapp-ai-additions';
const OTHER_ISSUER = 'http://localhost:8080/keycloak/realms/ethicapp-ai-additions';
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
    adapters: [
      {
        id: 'polyadic-agents',
        label: 'Agentes de discusión',
        description: 'Agentes en el chat',
        scopes: ['chat', 'unknown-scope'],
        requires: ['polyadic-agent']
      },
      { id: 'polyadic-older', description: 'Sin etiqueta ni ámbitos' }
    ]
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
        adapters: [
          { id: 'polyadic-agents', label: 'Agentes de discusión', description: 'Agentes en el chat', scopes: ['chat'] },
          { id: 'polyadic-older', label: null, description: 'Sin etiqueta ni ámbitos', scopes: [] }
        ]
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

  for (const code of ['not_configured', 'credentials_missing', 'unreachable', 'unauthorized', 'invalid_response']) {
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

    // AbortSignal.timeout uses an unref'd timer, so the fake keeps the event
    // loop alive until the abort arrives, like a pending socket would.
    const hanging = fakeFetch((url, init) => new Promise((resolve, reject) => {
      const keepAlive = setInterval(() => {}, 1000);
      init.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        reject(init.signal.reason);
      });
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
      issuer: { ok: true, expected: ISSUER, actual: ISSUER, claims: { sub: SECRET_TOKEN } },
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
      issuer: { ok: true, error: null, skipped: false, expected: ISSUER, actual: ISSUER },
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

  for (const code of ['credentials_missing', 'unreachable', 'unauthorized', 'invalid_response']) {
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
        issuer: null,
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
      issuer: null,
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

  it('passes through an issuer mismatch with both issuers and fails the test', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: false,
      token: { ok: true },
      issuer: { ok: false, error: 'issuer_mismatch', expected: ISSUER, actual: OTHER_ISSUER },
      catalog: { ok: true },
      serviceCount: 2
    }));

    assert.deepEqual(await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl }), {
      ok: false,
      error: 'issuer_mismatch',
      token: { ok: true, error: null, skipped: false },
      issuer: { ok: false, error: 'issuer_mismatch', skipped: false, expected: ISSUER, actual: OTHER_ISSUER },
      catalog: { ok: true, error: null, skipped: false },
      serviceCount: 2
    });
  });

  it('fails the test on an issuer step that failed even when ethicapp says ok', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: true,
      token: { ok: true },
      issuer: { ok: false, error: 'invalid_response', expected: ISSUER },
      catalog: { ok: true },
      serviceCount: 2
    }));

    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid_response');
    assert.deepEqual(result.issuer, { ok: false, error: 'invalid_response', skipped: false, expected: ISSUER, actual: null });
  });

  it('reports a skipped issuer step after a failed token step', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: false,
      token: { ok: false, error: 'unauthorized' },
      issuer: { ok: false, skipped: true, expected: ISSUER, actual: OTHER_ISSUER },
      catalog: { ok: false, skipped: true }
    }));

    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
    assert.equal(result.error, 'unauthorized');
    assert.deepEqual(result.issuer, { ok: false, error: null, skipped: true, expected: ISSUER, actual: null });
  });

  it('treats an omitted issuer step as not reported (older ethicapp)', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: true,
      token: { ok: true },
      catalog: { ok: true },
      serviceCount: 1
    }));

    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.error, null);
    assert.equal(result.issuer, null);
  });

  it('drops issuers that are not http(s) URLs of at most 2048 characters', async () => {
    const badValues = [
      'javascript:alert(1)',
      'ftp://kc.example.org/realms/r',
      'https://kc.example.org/realms/ r',
      `https://kc.example.org/${'a'.repeat(2048)}`,
      'https://',
      42,
      { href: ISSUER }
    ];

    for (const bad of badValues) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
        ok: false,
        token: { ok: true },
        issuer: { ok: false, error: 'issuer_mismatch', expected: bad, actual: bad },
        catalog: { ok: true },
        serviceCount: 0
      }));
      const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
      assert.deepEqual(result.issuer, {
        ok: false,
        error: 'issuer_mismatch',
        skipped: false,
        expected: null,
        actual: null
      }, String(bad));
    }
  });

  it('maps an unknown issuer error code to invalid_response, and issuer_mismatch on other steps too', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      token: { ok: true },
      issuer: { ok: false, error: 'something_new', expected: ISSUER },
      catalog: { ok: false, error: 'issuer_mismatch' }
    }));
    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl });
    assert.equal(result.issuer.error, 'invalid_response');
    assert.equal(result.catalog.error, 'invalid_response');
  });

  it('reports the issuer step as skipped when ethicapp cannot be reached', async () => {
    const refused = fakeFetch(() => { throw new TypeError('fetch failed'); });
    const result = await testAiAdditionsConnectionInEthicapp({ baseUrl: 'http://x', ...IDENTITY, fetchImpl: refused.fetchImpl });
    assert.deepEqual(result.issuer, { ok: false, error: null, skipped: true, expected: null, actual: null });
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
