import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import express from 'express';
import supertest from 'supertest';

import { createAdminUserAccountRouter } from './admin-user-account.routes.js';

const INTERNAL_TOKEN = 'test-internal-service-token';
process.env.AUTH_INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;

const PASSWORD = 'Temporary-Pass!42';
const HASH = '$2b$10$fakehashfakehashfakehashfakehashfakehashfakehashfake';
const ADMIN_ID = 7;
const NEW_ID = 314;

// A pool whose single client records its queries, answers the insert with
// NEW_ID, or fails it with `failWith`.
function createFakePool({ failWith = null } = {}) {
  const queries = [];
  let connected = 0;
  let released = 0;

  return {
    queries,
    get connected() {
      return connected;
    },
    get released() {
      return released;
    },
    async connect() {
      connected += 1;
      return {
        async query(text, params) {
          queries.push({ text: text.replace(/\s+/g, ' ').trim(), params });
          if (failWith) {
            throw failWith;
          }
          return { rowCount: 1, rows: [{ id: NEW_ID }] };
        },
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

function createApp({ pool = createFakePool(), welcomeFails = false, welcome = null, welcomeEmailTimeoutMs } = {}) {
  const hashCalls = [];
  const welcomeCalls = [];
  const logger = createLogger();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userId = Number(req.get('X-Test-User-Id') || 0);
    req.user = userId ? { id: userId, role: req.get('X-Test-User-Role') || 'A' } : undefined;
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use('/', createAdminUserAccountRouter({
    pool,
    logger,
    hashPassword: async (password) => {
      hashCalls.push(password);
      return HASH;
    },
    sendWelcomeEmail: async (message) => {
      welcomeCalls.push(message);
      if (welcome) {
        return welcome(message);
      }
      if (welcomeFails) {
        throw new Error('SMTP unavailable');
      }
      return undefined;
    },
    ...(welcomeEmailTimeoutMs ? { welcomeEmailTimeoutMs } : {})
  }));

  return { app, pool, logger, hashCalls, welcomeCalls };
}

function validBody(overrides = {}) {
  return {
    firstname: '  Ana ',
    lastname: ' Rojas ',
    gender: 'F',
    email: '  Ana.Rojas@Example.TEST ',
    role: 'P',
    preferred_locale: 'es_CL',
    password: PASSWORD,
    password_confirmation: PASSWORD,
    ...overrides
  };
}

function post(app, { token = INTERNAL_TOKEN, userId = ADMIN_ID, role = 'S', language = 'en-US' } = {}) {
  let request = supertest(app).post('/admin/users').set('Accept-Language', language);
  if (token) {
    request = request.set('X-Internal-Service-Token', token);
  }
  if (userId) {
    request = request.set('X-Test-User-Id', String(userId)).set('X-Test-User-Role', role);
  }
  return request;
}

function assertNoPasswordIn(...values) {
  for (const value of values) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    assert.ok(!text.includes(PASSWORD), 'the password must not appear');
    assert.ok(!text.includes(HASH), 'the hash must not appear');
  }
}

describe('POST /admin/users (#1170)', () => {
  let context;

  beforeEach(() => {
    context = createApp();
  });

  test('creates an active account with its email confirmed and sends the welcome email', async () => {
    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body, {
      id: NEW_ID,
      message: 'Account created. The user was sent a welcome email without the password',
      welcome_email_sent: true
    });
    assert.deepStrictEqual(context.hashCalls, [PASSWORD]);

    assert.strictEqual(context.pool.queries.length, 1);
    const [insert] = context.pool.queries;
    assert.match(insert.text, /^INSERT INTO users .* VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, 'local', true, true\) RETURNING id$/);
    assert.match(insert.text, /\(firstname, lastname, name, sex, mail, role, preferred_locale, password_bcrypt, auth_provider, active, email_confirmed\)/);
    assert.deepStrictEqual(insert.params, [
      'Ana',
      'Rojas',
      'Ana Rojas',
      'F',
      'ana.rojas@example.test',
      'P',
      'es_CL',
      HASH
    ]);
    assert.strictEqual(context.pool.released, 1);

    assert.deepStrictEqual(context.welcomeCalls, [{
      to: 'ana.rojas@example.test',
      firstname: 'Ana',
      preferredLocale: 'es_CL'
    }]);
    assertNoPasswordIn(res.body, context.welcomeCalls, context.logger.lines);
  });

  test('creates a student, reading the role in any letter case', async () => {
    const res = await post(context.app).send(validBody({ role: ' a ' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(context.pool.queries[0].params[5], 'A');
  });

  test("answers in the administrator's language, whatever the account's locale", async () => {
    const res = await post(context.app, { language: 'es-CL' }).send(validBody({ preferred_locale: 'en_US' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.message, 'Cuenta creada. Se envió al usuario un correo de bienvenida sin la contraseña');
    assert.strictEqual(context.pool.queries[0].params[6], 'en_US');
    assert.strictEqual(context.welcomeCalls[0].preferredLocale, 'en_US');
  });

  test("normalizes the account's locale, and falls back to the administrator's", async () => {
    await post(context.app).send(validBody({ preferred_locale: 'es-AR' }));
    await post(context.app, { language: 'es-CL,es;q=0.9' }).send(validBody({ preferred_locale: undefined }));
    await post(context.app, { language: 'fr-FR' }).send(validBody({ preferred_locale: '' }));

    assert.deepStrictEqual(context.pool.queries.map((query) => query.params[6]), ['es_CL', 'es_CL', 'en_US']);
  });

  test('keeps the account when the welcome email fails, and says so', async () => {
    context = createApp({ welcomeFails: true });

    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.body, {
      id: NEW_ID,
      message: 'Account created, but sending the welcome email could not be confirmed',
      welcome_email_sent: false
    });
    assert.strictEqual(context.logger.lines.length, 1);
    assert.match(context.logger.lines[0], /ADMIN CREATE ACCOUNT WELCOME EMAIL ERROR/);
    assert.match(context.logger.lines[0], /"userId":314/);
    assertNoPasswordIn(context.logger.lines);
  });

  test('answers without waiting for a welcome email that takes too long, and logs a later failure', async () => {
    let failLater;
    context = createApp({
      welcomeEmailTimeoutMs: 20,
      welcome: () => new Promise((resolve, reject) => {
        failLater = reject;
      })
    });

    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.welcome_email_sent, false);
    assert.strictEqual(context.logger.lines.length, 1);
    assert.match(context.logger.lines[0], /ADMIN CREATE ACCOUNT WELCOME EMAIL TIMEOUT/);

    failLater(new Error('SMTP gave up'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(context.logger.lines.length, 2);
    assert.match(context.logger.lines[1], /ADMIN CREATE ACCOUNT WELCOME EMAIL ERROR/);
    assertNoPasswordIn(context.logger.lines);
  });

  test('refuses an email already registered in any letter case, without logging or emailing', async () => {
    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'users_mail_lower_unique'
    });
    context = createApp({ pool: createFakePool({ failWith: duplicate }) });

    const res = await post(context.app, { language: 'es-CL' }).send(validBody());

    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, {
      error: 'Ya existe una cuenta con ese correo electrónico',
      code: 'EMAIL_ALREADY_REGISTERED'
    });
    assert.strictEqual(context.pool.released, 1);
    assert.strictEqual(context.logger.lines.length, 0);
    assert.strictEqual(context.welcomeCalls.length, 0);
  });

  test('answers 500 for another database error, logging neither the password nor the hash', async () => {
    const failure = Object.assign(new Error('connection lost'), { code: '08006' });
    context = createApp({ pool: createFakePool({ failWith: failure }) });

    const res = await post(context.app).send(validBody());

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.code, 'INTERNAL_ERROR');
    assert.strictEqual(context.pool.released, 1);
    assert.strictEqual(context.welcomeCalls.length, 0);
    assert.strictEqual(context.logger.lines.length, 1);
    assert.match(context.logger.lines[0], /ADMIN CREATE ACCOUNT ERROR/);
    assertNoPasswordIn(context.logger.lines);
  });

  const accessRefusals = [
    ['without the internal service token', { token: null }, 403, 'INTERNAL_SERVICE_TOKEN_REQUIRED'],
    ['with a wrong internal service token', { token: 'wrong-token' }, 403, 'INTERNAL_SERVICE_TOKEN_REQUIRED'],
    ['without a session', { userId: null }, 401, 'UNAUTHENTICATED'],
    ['for a teacher session', { role: 'P' }, 403, 'UNAUTHORIZED'],
    ['for a student session', { role: 'A' }, 403, 'UNAUTHORIZED']
  ];

  for (const [label, options, status, code] of accessRefusals) {
    test(`refuses ${label}`, async () => {
      const res = await post(context.app, options).send(validBody());

      assert.strictEqual(res.status, status);
      assert.strictEqual(res.body.code, code);
      assert.strictEqual(context.pool.connected, 0);
      assert.strictEqual(context.hashCalls.length, 0);
    });
  }

  const bodyRefusals = [
    ['a missing first name', { firstname: '   ' }, 'REQUIRED_FIELDS_MISSING', 'Required fields are missing'],
    ['a missing email', { email: '' }, 'REQUIRED_FIELDS_MISSING', 'Required fields are missing'],
    ['a missing role', { role: undefined }, 'REQUIRED_FIELDS_MISSING', 'Required fields are missing'],
    ['a missing password confirmation', { password_confirmation: '' }, 'REQUIRED_FIELDS_MISSING', 'Required fields are missing'],
    ['the administrator role', { role: 'S' }, 'INVALID_ROLE', 'Only student and teacher accounts can be created here'],
    ['an unknown role', { role: 'X' }, 'INVALID_ROLE', 'Only student and teacher accounts can be created here'],
    ['an email without a domain', { email: 'ana.rojas@' }, 'INVALID_EMAIL', 'Invalid email address'],
    ['an email with spaces', { email: 'ana rojas@example.test' }, 'INVALID_EMAIL', 'Invalid email address'],
    ['passwords that differ', { password_confirmation: `${PASSWORD}x` }, 'PASSWORDS_DO_NOT_MATCH', 'Passwords do not match'],
    ['a weak password', { password: 'abcdefghi!', password_confirmation: 'abcdefghi!' }, 'WEAK_PASSWORD', null],
    ['an invalid gender', { gender: 'X' }, 'INVALID_GENDER', 'Invalid gender']
  ];

  for (const [label, overrides, code, message] of bodyRefusals) {
    test(`refuses ${label} with 400 ${code}, before hashing or touching the database`, async () => {
      const res = await post(context.app).send(validBody(overrides));

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, code);
      if (message) {
        assert.strictEqual(res.body.error, message);
      }
      assert.strictEqual(context.pool.connected, 0);
      assert.strictEqual(context.hashCalls.length, 0);
      assert.strictEqual(context.welcomeCalls.length, 0);
      assertNoPasswordIn(res.body);
    });
  }

  test('refuses a body that is not an object as missing fields', async () => {
    const res = await post(context.app).set('Content-Type', 'application/json').send('[]');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'REQUIRED_FIELDS_MISSING');
  });
});
