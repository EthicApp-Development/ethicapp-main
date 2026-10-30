import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TEACHER_ACTIVITIES_ERROR_CODES,
  fetchOpenTeacherActivitiesFromEthicapp,
  finishTeacherActivitiesInEthicapp
} from '../ethicapp.service.js';

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

describe('ethicapp open teacher activities client', () => {
  it('calls the internal route with the operator identity and returns the count and ids', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: true, userId: 12, count: 2, sessionIds: [4, 9], extra: 'dropped'
    }));

    const result = await fetchOpenTeacherActivitiesFromEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });

    assert.deepEqual(result, { ok: true, count: 2, sessionIds: [4, 9] });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/admin\/users\/12\/open-activities$/);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.equal(calls[0].init.headers.Cookie, IDENTITY.cookie);
    assert.equal(calls[0].init.headers['X-User-Id'], '7');
    assert.equal(calls[0].init.headers['X-User-Role'], 'S');
    assert.equal(calls[0].init.headers['Accept-Language'], 'es-CL');
    assert.ok(calls[0].init.signal);
  });

  it('refuses an invalid teacher id without calling ethicapp', async () => {
    for (const teacherId of [0, -1, 1.5, '12', null, undefined]) {
      const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {}));
      const result = await fetchOpenTeacherActivitiesFromEthicapp({ teacherId, ...IDENTITY, fetchImpl });
      assert.deepEqual(result, { ok: false, error: 'invalid_user' });
      assert.equal(calls.length, 0);
    }
  });

  it('passes ethicapp refusals of the target user through', async () => {
    for (const [status, error] of [[400, 'invalid_user'], [404, 'user_not_found'], [400, 'not_a_teacher']]) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(status, { ok: false, error }));
      const result = await fetchOpenTeacherActivitiesFromEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });
      assert.deepEqual(result, { ok: false, error });
    }
  });

  it('maps other failures to the documented codes', async () => {
    const cases = [
      [() => { throw new TypeError('fetch failed'); }, 'unreachable'],
      [() => jsonResponse(403, { ok: false, error: 'forbidden' }), 'ethicapp_error'],
      [() => jsonResponse(500, { ok: false, error: 'internal_error' }), 'ethicapp_error'],
      [() => new Response('<html>Not found</html>', { status: 404 }), 'ethicapp_error'],
      [() => jsonResponse(200, { ok: true, count: 3, sessionIds: [1] }), 'invalid_response'],
      [() => jsonResponse(200, { ok: true, count: 1, sessionIds: ['1'] }), 'invalid_response'],
      [() => jsonResponse(200, 'not json'), 'invalid_response']
    ];

    for (const [handler, error] of cases) {
      const { fetchImpl } = fakeFetch(handler);
      const result = await fetchOpenTeacherActivitiesFromEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });
      assert.deepEqual(result, { ok: false, error });
      assert.ok(TEACHER_ACTIVITIES_ERROR_CODES.includes(error));
    }
  });
});

describe('ethicapp finish teacher activities client', () => {
  it('posts to the internal route and returns what was finished', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: true, userId: 12, finished: [4, 9], skipped: [11], failed: []
    }));

    const result = await finishTeacherActivitiesInEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });

    assert.deepEqual(result, { ok: true, error: null, finished: [4, 9], skipped: [11], failed: [] });
    assert.match(calls[0].url, /\/api\/admin\/users\/12\/finish-activities$/);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['X-User-Role'], 'S');
  });

  it('reports a partial result as finish_incomplete, with the failures', async () => {
    const { fetchImpl } = fakeFetch(() => jsonResponse(200, {
      ok: false,
      userId: 12,
      finished: [4],
      skipped: [],
      failed: [{ sessionId: 9, error: 'finish_failed' }, { sessionId: 10, error: 'Some <b>free text</b>' }]
    }));

    const result = await finishTeacherActivitiesInEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });

    assert.deepEqual(result, {
      ok: false,
      error: 'finish_incomplete',
      finished: [4],
      skipped: [],
      failed: [{ sessionId: 9, error: 'finish_failed' }, { sessionId: 10, error: 'finish_failed' }]
    });
  });

  it('rejects inconsistent or malformed bodies', async () => {
    const bodies = [
      { ok: true, finished: [4], skipped: [], failed: [{ sessionId: 9, error: 'finish_failed' }] },
      { ok: false, finished: [4], skipped: [], failed: [] },
      { ok: true, finished: [-4], skipped: [], failed: [] },
      { ok: true, finished: [4], failed: [] },
      { ok: false, finished: [], skipped: [], failed: [{ error: 'finish_failed' }] },
      { finished: [], skipped: [], failed: [] }
    ];

    for (const body of bodies) {
      const { fetchImpl } = fakeFetch(() => jsonResponse(200, body));
      const result = await finishTeacherActivitiesInEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });
      assert.deepEqual(result, { ok: false, error: 'invalid_response' }, JSON.stringify(body));
    }
  });

  it('maps refusals, failures and timeouts like the count', async () => {
    const cases = [
      [() => jsonResponse(404, { ok: false, error: 'user_not_found' }), 'user_not_found'],
      [() => jsonResponse(401, { ok: false, error: 'unauthenticated' }), 'ethicapp_error'],
      [() => { throw new DOMException('timed out', 'TimeoutError'); }, 'unreachable']
    ];

    for (const [handler, error] of cases) {
      const { fetchImpl } = fakeFetch(handler);
      const result = await finishTeacherActivitiesInEthicapp({ teacherId: 12, ...IDENTITY, fetchImpl });
      assert.deepEqual(result, { ok: false, error });
    }
  });

  it('refuses an invalid teacher id without calling ethicapp', async () => {
    const { calls, fetchImpl } = fakeFetch(() => jsonResponse(200, {}));
    const result = await finishTeacherActivitiesInEthicapp({ teacherId: '12/../../x', ...IDENTITY, fetchImpl });
    assert.deepEqual(result, { ok: false, error: 'invalid_user' });
    assert.equal(calls.length, 0);
  });
});
