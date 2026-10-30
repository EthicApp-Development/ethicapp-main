import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fetchUserErasureRequestsFromEthicapp,
  retryUserErasureRequestsInEthicapp,
  sanitizeErasureRequestsBody
} from '../user-erasure.service.js';

const IDENTITY = Object.freeze({
  cookie: 'auth.sid=auth-session',
  userId: 7,
  userRole: 'S',
  language: 'es-CL'
});

const REQUEST = Object.freeze({
  serviceId: 'polyadic-agent',
  status: 'pending',
  attempts: 2,
  nextAttemptAt: '2026-10-29T12:05:00.000Z',
  lastAttemptAt: '2026-10-29T12:03:00.000Z',
  lastError: 'HTTP_503',
  requestedAt: '2026-10-29T12:00:00.000Z',
  completedAt: null
});

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('user erasure client', () => {
  it('reads the requests from the internal endpoint with the operator identity', async () => {
    const seen = [];
    const result = await fetchUserErasureRequestsFromEthicapp({
      targetUserId: 22,
      ...IDENTITY,
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return jsonResponse(200, { ok: true, userId: 22, requests: [{ ...REQUEST, extra: 'dropped' }] });
      }
    });

    assert.deepEqual(result, { ok: true, requests: [REQUEST] });
    assert.match(seen[0].url, /\/api\/admin\/user-erasure\/users\/22$/);
    assert.equal(seen[0].init.method, 'GET');
    assert.equal(seen[0].init.headers['X-User-Id'], '7');
    assert.equal(seen[0].init.headers['X-User-Role'], 'S');
    assert.equal(seen[0].init.headers.Cookie, 'auth.sid=auth-session');
  });

  it('posts the retry', async () => {
    const seen = [];
    const result = await retryUserErasureRequestsInEthicapp({
      targetUserId: 22,
      ...IDENTITY,
      fetchImpl: async (url, init) => {
        seen.push({ url, init });
        return jsonResponse(200, { ok: true, retried: 1, requests: [REQUEST] });
      }
    });

    assert.equal(result.ok, true);
    assert.match(seen[0].url, /\/api\/admin\/user-erasure\/users\/22\/retry$/);
    assert.equal(seen[0].init.method, 'POST');
  });

  it('maps transport failures, error statuses and unexpected bodies to codes', async () => {
    const cases = [
      [async () => { throw new TypeError('fetch failed'); }, 'unreachable'],
      [async () => jsonResponse(500, { ok: false, error: 'internal_error' }), 'ethicapp_error'],
      [async () => jsonResponse(200, { ok: true, requests: [{ ...REQUEST, status: 'weird' }] }), 'invalid_response'],
      [async () => new Response('not json', { status: 200 }), 'invalid_response']
    ];

    for (const [fetchImpl, error] of cases) {
      assert.deepEqual(
        await fetchUserErasureRequestsFromEthicapp({ targetUserId: 22, ...IDENTITY, fetchImpl }),
        { ok: false, error }
      );
    }
  });

  it('keeps only codes as errors and valid timestamps', () => {
    assert.deepEqual(sanitizeErasureRequestsBody({
      ok: true,
      requests: [{ ...REQUEST, lastError: 'connect ECONNREFUSED 10.0.0.1', completedAt: 'yesterday' }]
    }), [{ ...REQUEST, lastError: null, completedAt: null }]);
    assert.equal(sanitizeErasureRequestsBody({ ok: true, requests: [{ ...REQUEST, serviceId: 'Bad Id' }] }), null);
    assert.equal(sanitizeErasureRequestsBody({ ok: false }), null);
  });
});
