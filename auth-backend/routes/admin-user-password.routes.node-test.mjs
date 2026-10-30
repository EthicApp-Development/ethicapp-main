import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import express from 'express';
import supertest from 'supertest';

import { createAdminUserPasswordRouter } from './admin-user-password.routes.js';

const INTERNAL_TOKEN = 'test-internal-service-token';
process.env.AUTH_INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;

const NEW_PASSWORD = 'Temporary-Pass!42';
const HASH = '$2b$10$fakehashfakehashfakehashfakehashfakehashfakehashfake';
const ADMIN_ID = 7;
const TARGET_ID = 22;
const TARGET_EMAIL = 'ana.student@example.test';

function targetRow(overrides = {}) {
  return {
    id: TARGET_ID,
    mail: TARGET_EMAIL,
    role: 'A',
    auth_provider: 'local',
    anonymized_at: null,
    ...overrides
  };
}

// A pool whose single client records its queries and answers the user
// SELECT with `row` (or no row), and fails the statement matching `failOn`.
function createFakePool({ row = targetRow(), failOn = null } = {}) {
  const queries = [];
  let released = 0;
  const client = {
    async query(text, params) {
      queries.push({ text: text.replace(/\s+/g, ' ').trim(), params });
      if (failOn && failOn.test(text)) {
        throw new Error('simulated database failure');
      }
      if (/FROM users/.test(text)) {
        return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  return {
    queries,
    get released() {
      return released;
    },
    async connect() {
      return {
        query: client.query,
        release() {
          released += 1;
        }
      };
    }
  };
}

function createLogger() {
  const lines = [];
  return {
    lines,
    error: (...args) => lines.push(JSON.stringify(args))
  };
}

function createApp({ pool = createFakePool(), logger = createLogger(), hashPassword } = {}) {
  const hashCalls = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = Number(req.get('X-Test-User-Id') || 0);
    req.user = userId ? { id: userId, role: req.get('X-Test-User-Role') || 'A' } : undefined;
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use('/', createAdminUserPasswordRouter({
    pool,
    logger,
    hashPassword: hashPassword || (async (password) => {
      hashCalls.push(password);
      return HASH;
    })
  }));

  return { app, pool, logger, hashCalls };
}

function validBody(overrides = {}) {
  return {
    new_password: NEW_PASSWORD,
    password_confirmation: NEW_PASSWORD,
    expected_email: TARGET_EMAIL,
    ...overrides
  };
}

function post(app, { token = INTERNAL_TOKEN, userId = ADMIN_ID, role = 'S', target = TARGET_ID, language } = {}) {
  let request = supertest(app).post(`/admin/users/${target}/password`);
  if (token) {
    request = request.set('X-Internal-Service-Token', token);
  }
  if (userId) {
    request = request.set('X-Test-User-Id', String(userId)).set('X-Test-User-Role', role);
  }
  if (language) {
    request = request.set('Accept-Language', language);
  }
  return request;
}

function assertNoPasswordIn(...values) {
  for (const value of values) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    assert.ok(!text.includes(NEW_PASSWORD), 'the password must not appear');
  }
}

describe('POST /admin/users/:id/password (#889)', () => {
  let context;

  beforeEach(() => {
    context = createApp();
  });

  test('sets the password, ends the sessions and deletes the reset tokens in one transaction', async () => {
    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { message: "Password set. The user's open sessions were closed", id: TARGET_ID });
    assert.deepStrictEqual(context.hashCalls, [NEW_PASSWORD]);

    const statements = context.pool.queries.map((query) => query.text);
    assert.strictEqual(statements.length, 5);
    assert.strictEqual(statements[0], 'BEGIN');
    assert.match(statements[1], /SELECT id, mail, role, auth_provider, anonymized_at FROM users WHERE id = \$1 FOR UPDATE/);
    assert.deepStrictEqual(context.pool.queries[1].params, [TARGET_ID]);
    assert.match(
      statements[2],
      /UPDATE users SET password_bcrypt = \$1, pass = NULL, session_version = session_version \+ 1 WHERE id = \$2$/
    );
    assert.deepStrictEqual(context.pool.queries[2].params, [HASH, TARGET_ID]);
    assert.match(statements[3], /DELETE FROM pass_reset WHERE lower\(mail\) = lower\(\$1\) AND token_purpose = 'password_reset'/);
    assert.deepStrictEqual(context.pool.queries[3].params, [TARGET_EMAIL]);
    assert.strictEqual(statements[4], 'COMMIT');
    assert.strictEqual(context.pool.released, 1);

    // Activation is left alone.
    assert.ok(statements.every((text) => !/\bactive\b|email_confirmed/.test(text)));
    assertNoPasswordIn(res.text, context.pool.queries, context.logger.lines);
  });

  test('sets the password of a teacher', async () => {
    context = createApp({ pool: createFakePool({ row: targetRow({ role: 'P' }) }) });

    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(context.pool.queries.at(-1).text, 'COMMIT');
  });

  test('compares the expected email ignoring case and surrounding spaces', async () => {
    const res = await post(context.app).send(validBody({ expected_email: '  ANA.Student@example.test ' }));

    assert.strictEqual(res.status, 200);
  });

  test('answers in Spanish when the request prefers it', async () => {
    const res = await post(context.app, { language: 'es-CL,es;q=0.9' }).send(validBody());

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'Contraseña establecida. Se cerraron las sesiones abiertas del usuario');
  });

  describe('access', () => {
    for (const [label, token] of [['without', null], ['with a wrong', 'not-the-token']]) {
      test(`refuses a request ${label} internal service token, even from an administrator`, async () => {
        const res = await post(context.app, { token }).send(validBody());

        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.code, 'INTERNAL_SERVICE_TOKEN_REQUIRED');
        assert.strictEqual(context.pool.queries.length, 0);
        assert.strictEqual(context.hashCalls.length, 0);
      });
    }

    test('refuses a request without a session', async () => {
      const res = await post(context.app, { userId: 0 }).send(validBody());

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.code, 'UNAUTHENTICATED');
      assert.strictEqual(context.pool.queries.length, 0);
    });

    for (const role of ['A', 'P']) {
      test(`refuses a session with role ${role}`, async () => {
        const res = await post(context.app, { role }).send(validBody());

        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.code, 'UNAUTHORIZED');
        assert.strictEqual(context.pool.queries.length, 0);
      });
    }
  });

  describe('validation, before any database access', () => {
    const cases = [
      ['an invalid user id', { target: 'abc' }, {}, 400, 'INVALID_USER_ID'],
      ['a zero user id', { target: 0 }, {}, 400, 'INVALID_USER_ID'],
      ['an out-of-range user id', { target: 2147483648 }, {}, 400, 'INVALID_USER_ID'],
      ['a missing password', {}, { new_password: undefined }, 400, 'REQUIRED_FIELDS_MISSING'],
      ['a missing confirmation', {}, { password_confirmation: '' }, 400, 'REQUIRED_FIELDS_MISSING'],
      ['a non-string password', {}, { new_password: 12345678901, password_confirmation: 12345678901 }, 400, 'REQUIRED_FIELDS_MISSING'],
      ['a non-string expected email', {}, { expected_email: ['x'] }, 400, 'INVALID_EXPECTED_EMAIL'],
      ['a confirmation that does not match', {}, { password_confirmation: `${NEW_PASSWORD}x` }, 400, 'PASSWORDS_DO_NOT_MATCH'],
      ['a weak password', {}, { new_password: 'abcdefghi!', password_confirmation: 'abcdefghi!' }, 400, 'WEAK_PASSWORD'],
      ["the administrator's own account", { target: ADMIN_ID }, {}, 409, 'OWN_ACCOUNT']
    ];

    for (const [label, requestOptions, bodyOverrides, status, code] of cases) {
      test(`refuses ${label}`, async () => {
        const res = await post(context.app, requestOptions).send(validBody(bodyOverrides));

        assert.strictEqual(res.status, status);
        assert.strictEqual(res.body.code, code);
        assert.strictEqual(typeof res.body.error, 'string');
        assert.strictEqual(context.pool.queries.length, 0);
        assert.strictEqual(context.hashCalls.length, 0);
        assertNoPasswordIn(res.text);
      });
    }

    test('refuses a weak password with the sign-up message, in both locales', async () => {
      const body = validBody({ new_password: 'abcdefg!!', password_confirmation: 'abcdefg!!' });

      const english = await post(context.app, { language: 'en-US' }).send(body);
      const spanish = await post(context.app, { language: 'es-CL' }).send(body);

      assert.strictEqual(english.body.error, 'Password must be at least 10 characters long and contain at least 2 symbols');
      assert.strictEqual(spanish.body.error, 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos');
    });

    test('refuses a mismatch with the sign-up message', async () => {
      const res = await post(context.app, { language: 'es-CL' })
        .send(validBody({ password_confirmation: 'Other-Pass!42' }));

      assert.strictEqual(res.body.error, 'Las contraseñas no coinciden');
    });
  });

  describe('refusals of the locked account, which change nothing', () => {
    const cases = [
      ['a missing account', null, {}, 404, 'USER_NOT_FOUND'],
      ['an anonymized account', targetRow({ anonymized_at: new Date(), mail: 'anon-22@anonymous.invalid' }), {}, 409, 'ACCOUNT_ANONYMIZED'],
      ['an administrator account', targetRow({ role: 'S' }), {}, 409, 'ROLE_NOT_ALLOWED'],
      ['an account without a role', targetRow({ role: null }), {}, 409, 'ROLE_NOT_ALLOWED'],
      ['an account that does not sign in with a password', targetRow({ auth_provider: 'google' }), {}, 409, 'NOT_LOCAL_ACCOUNT'],
      ['an account whose email changed', targetRow({ mail: 'other@example.test' }), {}, 409, 'ACCOUNT_CHANGED'],
      ['a request without the expected email', targetRow(), { expected_email: undefined }, 409, 'ACCOUNT_CHANGED'],
      ['a request with an empty expected email', targetRow(), { expected_email: '' }, 409, 'ACCOUNT_CHANGED']
    ];

    for (const [label, row, bodyOverrides, status, code] of cases) {
      test(`refuses ${label}`, async () => {
        context = createApp({ pool: createFakePool({ row }) });

        const res = await post(context.app).send(validBody(bodyOverrides));

        assert.strictEqual(res.status, status);
        assert.strictEqual(res.body.code, code);
        assert.deepStrictEqual(
          context.pool.queries.map((query) => query.text.split(' ')[0]),
          ['BEGIN', 'SELECT', 'ROLLBACK']
        );
        assert.strictEqual(context.pool.released, 1);
      });
    }

    test('treats an account without a provider as a local one', async () => {
      context = createApp({ pool: createFakePool({ row: targetRow({ auth_provider: null }) }) });

      const res = await post(context.app).send(validBody());

      assert.strictEqual(res.status, 200);
    });
  });

  test('rolls back and answers 500 without the password when a statement fails', async () => {
    const logger = createLogger();
    context = createApp({ pool: createFakePool({ failOn: /DELETE FROM pass_reset/ }), logger });

    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.code, 'INTERNAL_ERROR');
    assert.deepStrictEqual(
      context.pool.queries.map((query) => query.text.split(' ')[0]),
      ['BEGIN', 'SELECT', 'UPDATE', 'DELETE', 'ROLLBACK']
    );
    assert.strictEqual(context.pool.released, 1);
    assert.strictEqual(logger.lines.length, 1);
    assertNoPasswordIn(res.text, logger.lines);
    assert.ok(!logger.lines[0].includes(HASH), 'the hash must not be logged');
  });

  test('answers 500 without the password when hashing fails', async () => {
    const logger = createLogger();
    context = createApp({
      logger,
      hashPassword: async () => {
        throw new Error('hash failure');
      }
    });

    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 500);
    assert.strictEqual(context.pool.queries.length, 0);
    assertNoPasswordIn(res.text, logger.lines);
  });
});
