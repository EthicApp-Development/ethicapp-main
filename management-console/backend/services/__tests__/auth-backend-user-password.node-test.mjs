import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { setUserPasswordWithAuthBackend } from '../authBackend.service.js';

const NEW_PASSWORD = 'Temporary-Pass!42';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function request(fetchImpl, overrides = {}) {
  return setUserPasswordWithAuthBackend({
    userId: 22,
    newPassword: NEW_PASSWORD,
    passwordConfirmation: NEW_PASSWORD,
    expectedEmail: 'ana.student@example.test',
    cookie: 'auth.sid=auth-session',
    language: 'es-CL',
    fetchImpl,
    ...overrides
  });
}

describe('auth-backend client: setting a user password (#889)', () => {
  it("posts to the internal endpoint with the operator's cookie and the internal service token", async () => {
    const seen = [];
    const result = await request(async (url, init) => {
      seen.push({ url, init });
      return jsonResponse(200, { message: 'Contraseña establecida', id: 22 });
    });

    assert.deepEqual(result, { ok: true, message: 'Contraseña establecida' });
    assert.match(seen[0].url, /\/admin\/users\/22\/password$/);
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers.Cookie, 'auth.sid=auth-session');
    assert.equal(seen[0].init.headers['Accept-Language'], 'es-CL');
    assert.equal(typeof seen[0].init.headers['X-Internal-Service-Token'], 'string');
    assert.ok(seen[0].init.headers['X-Internal-Service-Token'].length > 0);
    assert.deepEqual(JSON.parse(seen[0].init.body), {
      new_password: NEW_PASSWORD,
      password_confirmation: NEW_PASSWORD,
      expected_email: 'ana.student@example.test'
    });
    assert.ok(!seen[0].url.includes(NEW_PASSWORD));
  });

  it('resolves a refusal to its status, code and localized message', async () => {
    const result = await request(async () => jsonResponse(400, {
      error: 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos',
      code: 'WEAK_PASSWORD'
    }));

    assert.deepEqual(result, {
      ok: false,
      status: 400,
      code: 'WEAK_PASSWORD',
      message: 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos'
    });
  });

  it('resolves a response that is not JSON to a refusal without a code', async () => {
    const result = await request(async () => new Response('Bad gateway', { status: 502 }));

    assert.deepEqual(result, { ok: false, status: 502, code: null, message: '' });
  });

  it('rejects when auth-backend cannot be reached, without the password in the error', async () => {
    await assert.rejects(
      request(async () => {
        throw new TypeError('fetch failed');
      }),
      (error) => !String(error?.message).includes(NEW_PASSWORD)
    );
  });

  it('encodes the user id into the path', async () => {
    const seen = [];
    await request(async (url) => {
      seen.push(url);
      return jsonResponse(200, {});
    }, { userId: '22/../../x' });

    assert.match(seen[0], /\/admin\/users\/22%2F..%2F..%2Fx\/password$/);
  });
});
