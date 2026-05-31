import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  createSessionPolicyMiddleware,
  getDefaultAuthSessionMaxAgeMs,
  getDefaultAuthSessionTtlSeconds,
  getRoleSessionPolicy,
  getSessionTouchIntervalMs,
  getUserSessionVersion,
  initializeSessionPolicy
} from '../sessionPolicy.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function createResponse() {
  return {
    statusCode: 200,
    ended: false,
    clearedCookie: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    clearCookie(name, options) {
      this.clearedCookie = { name, options };
      return this;
    }
  };
}

function runMiddleware({ req, nowMs }) {
  const res = createResponse();
  let nextCalled = false;
  const middleware = createSessionPolicyMiddleware({
    nowProvider: () => nowMs
  });

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

describe('auth-backend session policy', () => {
  beforeEach(() => {
    delete process.env.AUTH_SESSION_COOKIE_MAX_AGE_MS;
    delete process.env.AUTH_SESSION_ADMIN_IDLE_TIMEOUT_MS;
    delete process.env.AUTH_SESSION_ADMIN_ABSOLUTE_TIMEOUT_MS;
    delete process.env.AUTH_SESSION_PROFESSOR_IDLE_TIMEOUT_MS;
    delete process.env.AUTH_SESSION_PROFESSOR_ABSOLUTE_TIMEOUT_MS;
    delete process.env.AUTH_SESSION_STUDENT_IDLE_TIMEOUT_MS;
    delete process.env.AUTH_SESSION_STUDENT_ABSOLUTE_TIMEOUT_MS;
    delete process.env.AUTH_SESSION_TOUCH_INTERVAL_MS;
  });

  it('uses role-aware default timeout policies', () => {
    assert.deepEqual(getRoleSessionPolicy('S'), {
      idleTimeoutMs: 2 * HOUR_MS,
      absoluteTimeoutMs: 8 * HOUR_MS
    });
    assert.deepEqual(getRoleSessionPolicy('P'), {
      idleTimeoutMs: 7 * DAY_MS,
      absoluteTimeoutMs: 30 * DAY_MS
    });
    assert.deepEqual(getRoleSessionPolicy('A'), {
      idleTimeoutMs: DAY_MS,
      absoluteTimeoutMs: 7 * DAY_MS
    });
  });

  it('uses the longest absolute timeout as the default cookie and Redis TTL', () => {
    assert.equal(getDefaultAuthSessionMaxAgeMs(), 30 * DAY_MS);
    assert.equal(getDefaultAuthSessionTtlSeconds(), 30 * 24 * 60 * 60);
  });

  it('allows environment overrides per role', () => {
    process.env.AUTH_SESSION_ADMIN_IDLE_TIMEOUT_MS = '60000';
    process.env.AUTH_SESSION_ADMIN_ABSOLUTE_TIMEOUT_MS = '120000';

    assert.deepEqual(getRoleSessionPolicy('S'), {
      idleTimeoutMs: 60000,
      absoluteTimeoutMs: 120000
    });
  });

  it('uses a bounded touch interval to avoid excessive session writes', () => {
    assert.equal(getSessionTouchIntervalMs(getRoleSessionPolicy('S')), 5 * 60 * 1000);

    process.env.AUTH_SESSION_TOUCH_INTERVAL_MS = String(3 * HOUR_MS);

    assert.equal(getSessionTouchIntervalMs(getRoleSessionPolicy('S')), HOUR_MS);
  });

  it('initializes session policy metadata and role-specific cookie lifetime', () => {
    const req = {
      session: {
        cookie: {}
      }
    };

    initializeSessionPolicy(req, 'S', 1000, 3);

    assert.deepEqual(req.session.authPolicy, {
      role: 'S',
      sessionVersion: 3,
      createdAt: 1000,
      lastSeenAt: 1000
    });
    assert.equal(req.session.cookie.maxAge, 2 * HOUR_MS);
  });

  it('updates lastSeenAt and cookie lifetime for a valid session', () => {
    const req = {
      user: { role: 'S', sessionVersion: 4 },
      session: {
        cookie: {},
        authPolicy: {
          role: 'S',
          sessionVersion: 4,
          createdAt: 1000,
          lastSeenAt: 1000
        }
      }
    };

    const { nextCalled, res } = runMiddleware({
      req,
      nowMs: 1000 + HOUR_MS
    });

    assert.equal(nextCalled, true);
    assert.equal(res.ended, false);
    assert.equal(req.session.authPolicy.lastSeenAt, 1000 + HOUR_MS);
    assert.equal(req.session.authPolicy.sessionVersion, 4);
    assert.equal(req.session.cookie.maxAge, 2 * HOUR_MS);
  });

  it('does not touch a valid session before the touch interval elapses', () => {
    const req = {
      user: { role: 'S', sessionVersion: 4 },
      session: {
        cookie: { maxAge: 123 },
        authPolicy: {
          role: 'S',
          sessionVersion: 4,
          createdAt: 1000,
          lastSeenAt: 1000
        }
      }
    };

    const { nextCalled, res } = runMiddleware({
      req,
      nowMs: 1000 + (2 * 60 * 1000)
    });

    assert.equal(nextCalled, true);
    assert.equal(res.ended, false);
    assert.equal(req.session.authPolicy.lastSeenAt, 1000);
    assert.equal(req.session.cookie.maxAge, 123);
  });

  it('normalizes user session version from known user shapes', () => {
    assert.equal(getUserSessionVersion({ sessionVersion: 7 }), 7);
    assert.equal(getUserSessionVersion({ session_version: 8 }), 8);
    assert.equal(getUserSessionVersion({}), 1);
  });

  it('expires sessions when stored session version differs from the current user version', () => {
    let destroyed = false;
    const req = {
      user: { role: 'S', sessionVersion: 5 },
      session: {
        cookie: {},
        authPolicy: {
          role: 'S',
          sessionVersion: 4,
          createdAt: 1000,
          lastSeenAt: 1000
        },
        destroy(callback) {
          destroyed = true;
          callback();
        }
      }
    };

    const { nextCalled, res } = runMiddleware({
      req,
      nowMs: 1000 + HOUR_MS
    });

    assert.equal(nextCalled, false);
    assert.equal(destroyed, true);
    assert.equal(res.statusCode, 401);
    assert.equal(res.ended, true);
  });

  it('expires sessions that exceed idle timeout', () => {
    let destroyed = false;
    const req = {
      user: { role: 'S', sessionVersion: 1 },
      session: {
        cookie: {},
        authPolicy: {
          role: 'S',
          sessionVersion: 1,
          createdAt: 1000,
          lastSeenAt: 1000
        },
        destroy(callback) {
          destroyed = true;
          callback();
        }
      }
    };

    const { nextCalled, res } = runMiddleware({
      req,
      nowMs: 1000 + (2 * HOUR_MS) + 1
    });

    assert.equal(nextCalled, false);
    assert.equal(destroyed, true);
    assert.equal(res.statusCode, 401);
    assert.equal(res.ended, true);
    assert.deepEqual(res.clearedCookie, {
      name: 'auth.sid',
      options: { path: '/' }
    });
  });

  it('expires sessions that exceed absolute timeout even when recently active', () => {
    let destroyed = false;
    const req = {
      user: { role: 'S', sessionVersion: 1 },
      session: {
        cookie: {},
        authPolicy: {
          role: 'S',
          sessionVersion: 1,
          createdAt: 1000,
          lastSeenAt: 1000 + (7 * HOUR_MS)
        },
        destroy(callback) {
          destroyed = true;
          callback();
        }
      }
    };

    const { nextCalled, res } = runMiddleware({
      req,
      nowMs: 1000 + (8 * HOUR_MS) + 1
    });

    assert.equal(nextCalled, false);
    assert.equal(destroyed, true);
    assert.equal(res.statusCode, 401);
    assert.equal(res.ended, true);
  });
});
