import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';

import {
  verifyRecaptchaToken
} from './recaptcha.service.js';

const RECAPTCHA_ENV_KEYS = [
  'RECAPTCHA_ENABLED',
  'RECAPTCHA_PROVIDER',
  'RECAPTCHA_SECRET_KEY',
  'RECAPTCHA_VERIFY_URL',
  'RECAPTCHA_ENTERPRISE_PROJECT_ID',
  'RECAPTCHA_ENTERPRISE_API_KEY',
  'VITE_RECAPTCHA_SITE_KEY'
];

const originalEnv = Object.fromEntries(
  RECAPTCHA_ENV_KEYS.map((key) => [key, process.env[key]])
);

function resetRecaptchaEnv(overrides = {}) {
  for (const key of RECAPTCHA_ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

function mockFetchJson(body, { ok = true, status = 200 } = {}) {
  const fetchMock = mock.method(globalThis, 'fetch', async () => ({
    ok,
    status,
    json: async () => body
  }));

  return fetchMock;
}

describe('recaptcha service', () => {
  afterEach(() => {
    resetRecaptchaEnv();
    mock.restoreAll();
  });

  test('returns valid when reCAPTCHA is disabled', async () => {
    resetRecaptchaEnv({ RECAPTCHA_ENABLED: 'false' });
    const fetchMock = mockFetchJson({});

    const result = await verifyRecaptchaToken({
      token: '',
      remoteIp: '127.0.0.1'
    });

    assert.equal(result, true);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  test('returns invalid for missing tokens before requiring provider config', async () => {
    resetRecaptchaEnv({
      RECAPTCHA_ENABLED: 'true',
      RECAPTCHA_PROVIDER: 'enterprise'
    });
    const fetchMock = mockFetchJson({});

    const result = await verifyRecaptchaToken({
      token: '',
      remoteIp: '127.0.0.1'
    });

    assert.equal(result, false);
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  test('verifies classic tokens with the siteverify endpoint', async () => {
    resetRecaptchaEnv({
      RECAPTCHA_ENABLED: 'true',
      RECAPTCHA_PROVIDER: 'classic',
      RECAPTCHA_SECRET_KEY: 'classic-secret',
      RECAPTCHA_VERIFY_URL: 'https://captcha.example.test/siteverify'
    });
    const fetchMock = mockFetchJson({ success: true });

    const result = await verifyRecaptchaToken({
      token: 'classic-token',
      remoteIp: '127.0.0.1'
    });

    assert.equal(result, true);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(fetchMock.mock.calls[0].arguments[0], 'https://captcha.example.test/siteverify');
    assert.equal(fetchMock.mock.calls[0].arguments[1].method, 'POST');
    assert.equal(
      fetchMock.mock.calls[0].arguments[1].headers['Content-Type'],
      'application/x-www-form-urlencoded'
    );

    const params = new URLSearchParams(fetchMock.mock.calls[0].arguments[1].body);
    assert.equal(params.get('secret'), 'classic-secret');
    assert.equal(params.get('response'), 'classic-token');
    assert.equal(params.get('remoteip'), '127.0.0.1');
  });

  test('verifies Enterprise tokens with CreateAssessment', async () => {
    resetRecaptchaEnv({
      RECAPTCHA_ENABLED: 'true',
      RECAPTCHA_PROVIDER: 'enterprise',
      RECAPTCHA_ENTERPRISE_PROJECT_ID: 'ethicapp-project',
      RECAPTCHA_ENTERPRISE_API_KEY: 'enterprise-api-key',
      VITE_RECAPTCHA_SITE_KEY: 'enterprise-site-key'
    });
    const fetchMock = mockFetchJson({
      tokenProperties: {
        valid: true
      }
    });

    const result = await verifyRecaptchaToken({
      token: 'enterprise-token',
      remoteIp: '127.0.0.1',
      userAgent: 'recaptcha-test-agent'
    });

    assert.equal(result, true);
    assert.equal(fetchMock.mock.calls.length, 1);
    assert.equal(
      fetchMock.mock.calls[0].arguments[0],
      'https://recaptchaenterprise.googleapis.com/v1/projects/ethicapp-project/assessments?key=enterprise-api-key'
    );
    assert.equal(fetchMock.mock.calls[0].arguments[1].method, 'POST');
    assert.equal(
      fetchMock.mock.calls[0].arguments[1].headers['Content-Type'],
      'application/json; charset=utf-8'
    );
    assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body), {
      event: {
        token: 'enterprise-token',
        siteKey: 'enterprise-site-key',
        userAgent: 'recaptcha-test-agent',
        userIpAddress: '127.0.0.1'
      }
    });
  });

  test('rejects invalid Enterprise token properties', async () => {
    resetRecaptchaEnv({
      RECAPTCHA_ENABLED: 'true',
      RECAPTCHA_PROVIDER: 'enterprise',
      RECAPTCHA_ENTERPRISE_PROJECT_ID: 'ethicapp-project',
      RECAPTCHA_ENTERPRISE_API_KEY: 'enterprise-api-key',
      VITE_RECAPTCHA_SITE_KEY: 'enterprise-site-key'
    });
    mockFetchJson({
      tokenProperties: {
        valid: false,
        invalidReason: 'EXPIRED'
      }
    });

    const result = await verifyRecaptchaToken({
      token: 'expired-token',
      remoteIp: '127.0.0.1'
    });

    assert.equal(result, false);
  });

  test('throws on Enterprise HTTP errors', async () => {
    resetRecaptchaEnv({
      RECAPTCHA_ENABLED: 'true',
      RECAPTCHA_PROVIDER: 'enterprise',
      RECAPTCHA_ENTERPRISE_PROJECT_ID: 'ethicapp-project',
      RECAPTCHA_ENTERPRISE_API_KEY: 'enterprise-api-key',
      VITE_RECAPTCHA_SITE_KEY: 'enterprise-site-key'
    });
    mockFetchJson({}, { ok: false, status: 429 });

    await assert.rejects(
      verifyRecaptchaToken({
        token: 'enterprise-token',
        remoteIp: '127.0.0.1'
      }),
      /reCAPTCHA Enterprise assessment failed with status 429/
    );
  });

  test('throws when Enterprise configuration is incomplete', async () => {
    resetRecaptchaEnv({
      RECAPTCHA_ENABLED: 'true',
      RECAPTCHA_PROVIDER: 'enterprise',
      RECAPTCHA_ENTERPRISE_PROJECT_ID: 'ethicapp-project',
      VITE_RECAPTCHA_SITE_KEY: 'enterprise-site-key'
    });

    await assert.rejects(
      verifyRecaptchaToken({
        token: 'enterprise-token',
        remoteIp: '127.0.0.1'
      }),
      /RECAPTCHA_ENTERPRISE_API_KEY is not configured/
    );
  });
});
