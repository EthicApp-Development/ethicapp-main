import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SENSITIVE_ACTION_ERRORS, createSensitiveActionVerifier } from '../sensitive-action.service.js';

function createRequest({ body = {}, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );

  return {
    body,
    headers: normalizedHeaders,
    ip: '203.0.113.5',
    get: (name) => normalizedHeaders[name.toLowerCase()]
  };
}

function createResponse() {
  return {
    statusCode: null,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function createVerifier({
  passkeys = [],
  recaptchaValid = true,
  passwordValid = true,
  passkeyResult = true
} = {}) {
  const calls = { recaptcha: [], passkeys: [], password: [], passkey: [] };

  const verify = createSensitiveActionVerifier({
    verifyRecaptchaTokenService: async (payload) => {
      calls.recaptcha.push(payload);
      return recaptchaValid;
    },
    listAdminPasskeysService: async (payload) => {
      calls.passkeys.push(payload);
      return { passkeys };
    },
    verifyAdminPasswordService: async (payload) => {
      calls.password.push(payload);
      return passwordValid;
    },
    verifyAdminPasskeyService: async (payload) => {
      calls.passkey.push(payload);
      if (passkeyResult instanceof Error) {
        throw passkeyResult;
      }
      return passkeyResult;
    }
  });

  return { verify, calls };
}

const HEADERS = {
  Cookie: 'auth.sid=admin-session',
  'Accept-Language': 'es-CL',
  'User-Agent': 'test-agent',
  Origin: 'https://ethicapp.example.org'
};

describe('sensitive action verifier', () => {
  it('accepts a password and reCAPTCHA when the administrator has no passkeys', async () => {
    const { verify, calls } = createVerifier();
    const res = createResponse();

    const verified = await verify(createRequest({
      body: { admin_password: 'admin-secret', recaptcha_token: 'token-1' },
      headers: HEADERS
    }), res);

    assert.equal(verified, true);
    assert.equal(res.statusCode, null);
    assert.deepEqual(calls.passkeys, [{ cookie: 'auth.sid=admin-session', language: 'es-CL' }]);
    assert.deepEqual(calls.recaptcha, [{ token: 'token-1', remoteIp: '203.0.113.5', userAgent: 'test-agent' }]);
    assert.deepEqual(calls.password, [{ password: 'admin-secret', cookie: 'auth.sid=admin-session', language: 'es-CL' }]);
    assert.equal(calls.passkey.length, 0);
  });

  it('accepts a passkey assertion without reading passkeys, reCAPTCHA or the password', async () => {
    const { verify, calls } = createVerifier({ passkeys: [{ id: 1 }] });
    const res = createResponse();
    const assertion = { id: 'credential-1', response: {} };

    const verified = await verify(createRequest({ body: { passkey_assertion: assertion }, headers: HEADERS }), res);

    assert.equal(verified, true);
    assert.deepEqual(calls.passkey, [{
      assertion,
      cookie: 'auth.sid=admin-session',
      language: 'es-CL',
      origin: 'https://ethicapp.example.org'
    }]);
    assert.equal(calls.passkeys.length + calls.recaptcha.length + calls.password.length, 0);
  });

  it('refuses the password fallback with 401 PASSKEY_REQUIRED when passkeys exist', async () => {
    const { verify, calls } = createVerifier({ passkeys: [{ id: 1 }] });
    const res = createResponse();

    const verified = await verify(createRequest({
      body: { admin_password: 'admin-secret', recaptcha_token: 'token-1' }
    }), res);

    assert.equal(verified, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: SENSITIVE_ACTION_ERRORS.passkeyRequired });
    assert.equal(calls.recaptcha.length + calls.password.length, 0);
  });

  it('refuses a passkey that auth-backend does not verify with 401', async () => {
    const { verify } = createVerifier({ passkeyResult: false });
    const res = createResponse();

    assert.equal(await verify(createRequest({ body: { passkey_assertion: { id: 'x' } } }), res), false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Invalid administrator passkey' });
  });

  for (const status of [400, 401]) {
    it(`treats a ${status} from auth-backend passkey verification as an invalid passkey`, async () => {
      const { verify } = createVerifier({
        passkeyResult: Object.assign(new Error('PASSKEY_AUTHENTICATION_FAILED'), { status })
      });
      const res = createResponse();

      assert.equal(await verify(createRequest({ body: { passkey_assertion: { id: 'x' } } }), res), false);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: 'Invalid administrator passkey' });
    });
  }

  it('propagates passkey verification failures that are not client errors', async () => {
    const { verify } = createVerifier({
      passkeyResult: Object.assign(new Error('auth-backend down'), { status: 503 })
    });

    await assert.rejects(
      verify(createRequest({ body: { passkey_assertion: { id: 'x' } } }), createResponse()),
      /auth-backend down/
    );
  });

  it('refuses a failed reCAPTCHA with 400 before checking the password', async () => {
    const { verify, calls } = createVerifier({ recaptchaValid: false });
    const res = createResponse();

    const verified = await verify(createRequest({
      body: { admin_password: 'admin-secret', recaptcha_token: 'bad' }
    }), res);

    assert.equal(verified, false);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: 'Invalid recaptcha token' });
    assert.equal(calls.password.length, 0);
  });

  it('refuses a wrong password with 401', async () => {
    const { verify } = createVerifier({ passwordValid: false });
    const res = createResponse();

    const verified = await verify(createRequest({
      body: { admin_password: 'wrong', recaptcha_token: 'token-1' }
    }), res);

    assert.equal(verified, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Invalid administrator password' });
  });

  it('handles a request without a body as an empty confirmation', async () => {
    const { verify, calls } = createVerifier({ recaptchaValid: false });
    const res = createResponse();
    const req = createRequest();
    req.body = undefined;

    assert.equal(await verify(req, res), false);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.recaptcha[0].token, '');
  });
});
