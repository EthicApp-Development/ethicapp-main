import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS,
  getManagementSessionCookieMaxAgeMs
} from '../session.js';

describe('management-console session config', () => {
  beforeEach(() => {
    delete process.env.MNG_SESSION_COOKIE_MAX_AGE_MS;
  });

  it('defaults the local management session cookie to two hours', () => {
    assert.equal(DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS, 2 * 60 * 60 * 1000);
    assert.equal(getManagementSessionCookieMaxAgeMs(), DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS);
  });

  it('allows environment overrides for the local session cookie lifetime', () => {
    process.env.MNG_SESSION_COOKIE_MAX_AGE_MS = '60000';

    assert.equal(getManagementSessionCookieMaxAgeMs(), 60000);
  });

  it('falls back to the default when the configured value is invalid', () => {
    process.env.MNG_SESSION_COOKIE_MAX_AGE_MS = 'not-a-number';

    assert.equal(getManagementSessionCookieMaxAgeMs(), DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS);

    process.env.MNG_SESSION_COOKIE_MAX_AGE_MS = '-1';

    assert.equal(getManagementSessionCookieMaxAgeMs(), DEFAULT_MNG_SESSION_COOKIE_MAX_AGE_MS);
  });
});
