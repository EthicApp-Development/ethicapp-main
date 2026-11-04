import { test, mock, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import supertest from 'supertest';
import bcrypt from 'bcrypt';

const dbMock = { query: mock.fn() };
const recaptchaMock = { verifyRecaptchaToken: mock.fn() };
const mailMock = {
  sendPasswordResetEmail: mock.fn(),
  sendAccountConfirmationEmail: mock.fn()
};
const passwordResetMock = {
  findValidTokenMail: mock.fn(),
  resetPassword: mock.fn()
};
const simpleWebAuthnServerMock = {
  generateAuthenticationOptions: mock.fn(),
  generateRegistrationOptions: mock.fn(),
  verifyAuthenticationResponse: mock.fn(),
  verifyRegistrationResponse: mock.fn()
};

mock.module('../config/database.js', { defaultExport: dbMock });
mock.module('../services/recaptcha.service.js', { defaultExport: recaptchaMock });
mock.module('../services/mail.service.js', { defaultExport: mailMock });
mock.module('../services/password-reset.service.js', { defaultExport: passwordResetMock });
mock.module('@simplewebauthn/server', {
  namedExports: simpleWebAuthnServerMock
});

const { default: authRoutes } = await import('./auth.routes.js');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.login = mock.fn((user, cb) => cb());
  req.session = {};
  const testUserId = Number(req.get('X-Test-User-Id') || 0);
  req.user = testUserId
    ? {
        id: testUserId,
        role: req.get('X-Test-User-Role') || 'A'
      }
    : undefined;
  req.isAuthenticated = mock.fn(() => Boolean(req.user));
  next();
});
app.use('/', authRoutes);
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

function createUser(overrides = {}) {
  return {
    id: 1,
    mail: 'test@example.com',
    role: 'A',
    auth_provider: 'local',
    active: true,
    email_confirmed: true,
    password_bcrypt: '',
    ...overrides
  };
}

function validRegistrationPayload(overrides = {}) {
  return {
    firstname: 'John',
    lastname: 'Doe',
    gender: 'M',
    email: 'john@example.com',
    password: 'StrongPassword123!@',
    password_confirmation: 'StrongPassword123!@',
    recaptcha_token: 'valid_token',
    ...overrides
  };
}

function validProfessorPayload(overrides = {}) {
  return {
    firstname: 'Pat',
    lastname: 'Teacher',
    gender: 'F',
    email: 'pat@example.com',
    password: 'StrongPassword123!@',
    password_confirmation: 'StrongPassword123!@',
    ...overrides
  };
}

function sha256Hex(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

describe('Auth Routes', () => {
  beforeEach(() => {
    dbMock.query.mock.resetCalls();
    dbMock.query.mock.restore();
    passwordResetMock.findValidTokenMail.mock.resetCalls();
    passwordResetMock.resetPassword.mock.resetCalls();
    recaptchaMock.verifyRecaptchaToken.mock.resetCalls();
    recaptchaMock.verifyRecaptchaToken.mock.restore();
    mailMock.sendPasswordResetEmail.mock.resetCalls();
    mailMock.sendPasswordResetEmail.mock.restore();
    mailMock.sendAccountConfirmationEmail.mock.resetCalls();
    mailMock.sendAccountConfirmationEmail.mock.restore();
    simpleWebAuthnServerMock.generateRegistrationOptions.mock.resetCalls();
    simpleWebAuthnServerMock.generateRegistrationOptions.mock.restore();
    simpleWebAuthnServerMock.generateAuthenticationOptions.mock.resetCalls();
    simpleWebAuthnServerMock.generateAuthenticationOptions.mock.restore();
    simpleWebAuthnServerMock.verifyRegistrationResponse.mock.resetCalls();
    simpleWebAuthnServerMock.verifyRegistrationResponse.mock.restore();
    simpleWebAuthnServerMock.verifyAuthenticationResponse.mock.resetCalls();
    simpleWebAuthnServerMock.verifyAuthenticationResponse.mock.restore();
  });

  test('POST /login - missing credentials', async () => {
    const res = await supertest(app)
      .post('/login')
      .send({});

    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  test('GET /institution - returns the configured institution name', async () => {
    dbMock.query.mock.mockImplementation((sql) => {
      if (sql.includes('FROM institutional_contacts')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            firstname: 'Privacy',
            lastname: 'Officer',
            email: 'privacy@example.com'
          }]
        });
      }

      if (sql.includes('FROM institution')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ name: '  Universidad de Prueba  ' }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .get('/institution');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      name: 'Universidad de Prueba',
      privacyContact: 'Privacy Officer <privacy@example.com>'
    });
    assert.match(dbMock.query.mock.calls[0].arguments[0], /FROM institution/);
    assert.match(dbMock.query.mock.calls[1].arguments[0], /FROM institutional_contacts/);
  });

  test('POST /login - invalid credentials when user is not found', async () => {
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }));

    const res = await supertest(app)
      .post('/login')
      .send({ username: 'test@example.com', password: 'password123' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(dbMock.query.mock.calls.length, 1);
  });

  test('POST /login - invalid credentials when password does not match', async () => {
    const hashedPassword = await bcrypt.hash('different-password', 1);
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [createUser({ password_bcrypt: hashedPassword })]
    }));

    const res = await supertest(app)
      .post('/login')
      .send({ username: 'test@example.com', password: 'password123' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(dbMock.query.mock.calls.length, 1);
  });

  test('POST /login - valid credentials return the role-specific redirect', async () => {
    const hashedPassword = await bcrypt.hash('password123', 1);
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [createUser({
        role: 'S',
        password_bcrypt: hashedPassword
      })]
    }));

    const res = await supertest(app)
      .post('/login')
      .send({ username: 'test@example.com', password: 'password123' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.redirectTo, '/mng');
    assert.strictEqual(dbMock.query.mock.calls.length, 2);

    const updateCall = dbMock.query.mock.calls[1];
    assert.match(updateCall.arguments[0], /UPDATE users\s+SET last_login_at = NOW\(\)\s+WHERE id = \$1/);
    assert.deepStrictEqual(updateCall.arguments[1], [1]);
  });

  // A fake users table that answers the login query as PostgreSQL would:
  // the query must match the email only, ignoring letter case.
  function mockLoginLookup(user) {
    dbMock.query.mock.mockImplementation((sql, params) => {
      if (sql.includes('FROM users') && sql.includes('email_confirmed = true')) {
        assert.match(sql, /AND lower\(mail\) = lower\(\$1\)/);
        assert.doesNotMatch(sql, /\brut\b/);
        const matches = user.mail.toLowerCase() === String(params[0]).toLowerCase();
        return Promise.resolve(matches ? { rowCount: 1, rows: [user] } : { rowCount: 0, rows: [] });
      }
      return Promise.resolve({ rowCount: 1, rows: [] });
    });
  }

  test('POST /login - signs in by email, ignoring letter case', async () => {
    mockLoginLookup(createUser({ password_bcrypt: await bcrypt.hash('password123', 1) }));

    const res = await supertest(app)
      .post('/login')
      .send({ username: 'Test@Example.COM', password: 'password123' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.redirectTo, '/student');
    assert.deepStrictEqual(dbMock.query.mock.calls[0].arguments[1], ['Test@Example.COM']);
  });

  test('POST /login - a national ID as username gets the wrong-credentials error', async () => {
    mockLoginLookup(createUser({ password_bcrypt: await bcrypt.hash('password123', 1) }));

    const res = await supertest(app)
      .post('/login')
      .send({ username: '12345678-9', password: 'password123' });

    assert.strictEqual(res.status, 401);
    assert.deepStrictEqual(res.body, { error: 'Incorrect credentials' });
    assert.strictEqual(dbMock.query.mock.calls.length, 1);
  });

  for (const [role, destination] of [['A', '/student'], ['P', '/home'], ['S', '/mng']]) {
    for (const returnTo of [undefined, '/student/?join=abc123', '/student/sessions/57', 'https://evil.example/']) {
      test(`POST /login - role ${role} keeps its landing page despite returnTo ${returnTo}`, async () => {
        const hashedPassword = await bcrypt.hash('password123', 1);
        dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
          rowCount: 1,
          rows: [createUser({ role, password_bcrypt: hashedPassword })]
        }));

        const res = await supertest(app)
          .post('/login')
          .send({ username: 'test@example.com', password: 'password123', returnTo });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.redirectTo, destination);
      });
    }
  }

  test('GET /session - reports an anonymous visitor as unauthenticated', async () => {
    const res = await supertest(app).get('/session');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { authenticated: false });
    assert.strictEqual(res.headers['cache-control'], 'no-store');
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  for (const [role, destination] of [['A', '/student'], ['P', '/home'], ['S', '/mng']]) {
    test(`GET /session - sends a signed-in role ${role} to ${destination}, as POST /login does`, async () => {
      const res = await supertest(app)
        .get('/session')
        .set('X-Test-User-Id', '7')
        .set('X-Test-User-Role', role);

      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.body, {
        authenticated: true,
        role,
        redirectTo: destination
      });
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      assert.strictEqual(dbMock.query.mock.calls.length, 0);
    });
  }

  for (const role of ['X', 'constructor']) {
    test(`GET /session - gives no destination to a role without a home (${JSON.stringify(role)})`, async () => {
      const res = await supertest(app)
        .get('/session')
        .set('X-Test-User-Id', '7')
        .set('X-Test-User-Role', role);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.authenticated, true);
      assert.strictEqual(res.body.redirectTo, null);
    });
  }

  test('POST /register - missing fields are rejected before reCAPTCHA', async () => {
    const res = await supertest(app)
      .post('/register')
      .send({});

    assert.strictEqual(res.status, 400);
    assert.strictEqual(recaptchaMock.verifyRecaptchaToken.mock.calls.length, 0);
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  test('POST /register - invalid reCAPTCHA is rejected before database access', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(false));

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload());

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Invalid reCAPTCHA validation');
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  test('POST /register - weak passwords are rejected before database access', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload({
        password: 'weak',
        password_confirmation: 'weak'
      }));

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Password must be at least 10 characters long and contain at least 2 symbols');
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  test('POST /register - duplicate email returns recovery metadata', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [{ id: 7 }]
    }));

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload());

    assert.strictEqual(res.status, 409);
    assert.deepStrictEqual(res.body, {
      error: 'An account with that email already exists',
      code: 'email_already_registered',
      recovery_path: '/forgot'
    });
  });

  test('POST /register - an email that differs only in letter case is a duplicate', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [{ id: 7 }]
    }));

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload({ email: 'JOHN@example.com' }));

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'email_already_registered');

    const [sql, params] = dbMock.query.mock.calls[0].arguments;
    assert.match(sql, /WHERE lower\(mail\) = \$1/);
    assert.doesNotMatch(sql, /\brut\b/);
    assert.deepStrictEqual(params, ['john@example.com']);
  });

  // A sign-up with the same email commits between the duplicate check and
  // the insert: the unique index refuses the insert.
  for (const [label, violation] of [
    ['the case-insensitive index', { constraint: 'users_mail_lower_unique' }],
    ['the index detail', { detail: 'Key (lower(mail))=(john@example.com) already exists.' }]
  ]) {
    test(`POST /register - a unique violation on ${label} answers as a duplicate email`, async () => {
      const consoleError = mock.method(console, 'error', () => {});
      recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
      dbMock.query.mock.mockImplementation((queryStr) => {
        if (queryStr.includes('INSERT INTO users')) {
          return Promise.reject(Object.assign(new Error('duplicate key value'), { code: '23505', ...violation }));
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });

      const res = await supertest(app)
        .post('/register')
        .send(validRegistrationPayload());

      consoleError.mock.restore();
      assert.strictEqual(res.status, 409);
      assert.deepStrictEqual(res.body, {
        error: 'An account with that email already exists',
        code: 'email_already_registered',
        recovery_path: '/forgot'
      });
      // An expected outcome: answered without logging an error.
      assert.strictEqual(consoleError.mock.calls.length, 0);
      const statements = dbMock.query.mock.calls.map((call) => call.arguments[0].trim());
      assert.ok(statements.includes('ROLLBACK'));
      assert.strictEqual(mailMock.sendAccountConfirmationEmail.mock.calls.length, 0);
    });
  }

  test('POST /register-prof - checks the email ignoring letter case', async () => {
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({ rowCount: 1, rows: [{ id: 7 }] }));

    const res = await supertest(app)
      .post('/register-prof')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .send(validProfessorPayload({ email: 'Pat@Example.com' }));

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'An account with that email already exists');
    const [sql, params] = dbMock.query.mock.calls[0].arguments;
    assert.match(sql, /WHERE lower\(mail\) = \$1/);
    assert.doesNotMatch(sql, /\brut\b/);
    assert.deepStrictEqual(params, ['pat@example.com']);
    assert.strictEqual(dbMock.query.mock.calls.length, 1);
  });

  test('POST /register-prof - requires the email', async () => {
    const res = await supertest(app)
      .post('/register-prof')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .send(validProfessorPayload({ email: '  ' }));

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Required fields are missing');
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  test('POST /register-prof - creates the professor without a national ID, ignoring one sent by an older client', async () => {
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('INSERT INTO users')) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 51 }] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .post('/register-prof')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .send(validProfessorPayload({ dni: '12345678-9' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user_id, 51);

    const insertCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('INSERT INTO users'));
    assert.doesNotMatch(insertCall.arguments[0], /\brut\b/);
    assert.ok(!insertCall.arguments[1].includes('12345678-9'));
    assert.deepStrictEqual(insertCall.arguments[1].slice(0, 6), [
      'Pat',
      'Teacher',
      'Pat Teacher',
      'F',
      'pat@example.com',
      'P'
    ]);
  });

  test('POST /register-prof - a unique violation on the email index answers as the duplicate check', async () => {
    const consoleError = mock.method(console, 'error', () => {});
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('INSERT INTO users')) {
        return Promise.reject(Object.assign(new Error('duplicate key value'), {
          code: '23505',
          constraint: 'users_mail_lower_unique'
        }));
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .post('/register-prof')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .send(validProfessorPayload());

    consoleError.mock.restore();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.error, 'An account with that email already exists');
    assert.strictEqual(consoleError.mock.calls.length, 0);
  });

  test('POST /register - an unexpected database error is logged and answered 500', async () => {
    const consoleError = mock.method(console, 'error', () => {});
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('INSERT INTO users')) {
        return Promise.reject(Object.assign(new Error('connection lost'), { code: '08006' }));
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload());

    consoleError.mock.restore();
    assert.strictEqual(res.status, 500);
    assert.deepStrictEqual(res.body, { error: 'Internal server error' });
    assert.strictEqual(consoleError.mock.calls.length, 1);
    assert.strictEqual(consoleError.mock.calls[0].arguments[0], 'REGISTER ERROR:');
  });

  test('POST /register - a national ID sent by an older client is ignored, not stored', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('INSERT INTO users')) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 44 }] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    mailMock.sendAccountConfirmationEmail.mock.mockImplementationOnce(() => Promise.resolve());

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload({ dni: '12345678-9' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user_id, 44);

    for (const call of dbMock.query.mock.calls) {
      assert.doesNotMatch(call.arguments[0], /\brut\b/);
      assert.ok(!(call.arguments[1] || []).includes('12345678-9'));
    }
  });

  test('POST /register - valid registration without a national ID stores inactive pending account and sends confirmation mail', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('INSERT INTO users')) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 42 }] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    mailMock.sendAccountConfirmationEmail.mock.mockImplementationOnce(() => Promise.resolve());

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload({ preferred_locale: 'es_AR' }));

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.user_id, 42);

    const insertCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('INSERT INTO users'));
    assert.ok(insertCall);
    assert.deepStrictEqual(insertCall.arguments[1].slice(0, 7), [
      'John',
      'Doe',
      'John Doe',
      'M',
      'john@example.com',
      'A',
      'es_CL'
    ]);
    assert.strictEqual(await bcrypt.compare('StrongPassword123!@', insertCall.arguments[1][7]), true);
    assert.strictEqual(insertCall.arguments[1][8], 'local');

    const insertSql = insertCall.arguments[0];
    assert.doesNotMatch(insertSql, /\brut\b/);
    assert.match(insertSql, /active,\s*email_confirmed/);
    assert.match(insertSql, /false,\s*false/);

    const tokenInsertCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('INSERT INTO pass_reset'));
    assert.strictEqual(tokenInsertCall.arguments[1][0], 'john@example.com');
    assert.strictEqual(tokenInsertCall.arguments[1][2], 'account_confirmation');

    assert.strictEqual(mailMock.sendAccountConfirmationEmail.mock.calls.length, 1);
    const mailArgs = mailMock.sendAccountConfirmationEmail.mock.calls[0].arguments[0];
    assert.strictEqual(mailArgs.to, 'john@example.com');
    assert.strictEqual(mailArgs.preferredLocale, 'es_CL');
    assert.strictEqual(sha256Hex(mailArgs.rawToken), tokenInsertCall.arguments[1][1]);
  });

  test('POST /register - account remains recoverable when confirmation email fails', async () => {
    const consoleError = mock.method(console, 'error', () => {});
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('INSERT INTO users')) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: 43 }] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    mailMock.sendAccountConfirmationEmail.mock.mockImplementationOnce(() => Promise.reject(new Error('smtp down')));

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload());

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.code, 'confirmation_email_failed');
    assert.strictEqual(res.body.user_id, 43);
    assert.strictEqual(consoleError.mock.calls.length, 1);
    consoleError.mock.restore();
  });

  test('GET /confirm-account - activates pending accounts with a valid token', async () => {
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('FROM pass_reset pr')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ mail: 'pending@example.com' }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .get('/confirm-account/confirmation-token');

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/auth/login?confirmed=1');

    const lookupCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('FROM pass_reset pr'));
    assert.deepStrictEqual(lookupCall.arguments[1], [sha256Hex('confirmation-token'), 60]);

    const updateCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('email_confirmed = true'));
    assert.deepStrictEqual(updateCall.arguments[1], ['pending@example.com']);
  });

  test('GET /confirm-account - keeps query-token links compatible', async () => {
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }));

    const res = await supertest(app)
      .get('/confirm-account')
      .query({ token: 'old-link-token' });

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/auth/login?confirmed=invalid');
    assert.deepStrictEqual(dbMock.query.mock.calls[0].arguments[1], [sha256Hex('old-link-token'), 60]);
  });

  test('GET /confirm-account - treats already confirmed accounts as successful while token is valid', async () => {
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('FROM pass_reset pr')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ mail: 'confirmed@example.com', email_confirmed: true }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .get('/confirm-account/scanner-opened-token');

    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.location, '/auth/login?confirmed=1');

    const updateCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('UPDATE users'));
    assert.strictEqual(updateCall, undefined);
  });

  test('POST /forgot - unknown email returns generic response without sending mail', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }));

    const res = await supertest(app)
      .post('/forgot')
      .send({
        email: 'missing@example.com',
        recaptcha_token: 'valid_token'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'If the email exists, you will receive instructions to reset your password');
    assert.strictEqual(mailMock.sendPasswordResetEmail.mock.calls.length, 0);
  });

  test('POST /forgot - existing email stores a reset token digest and sends localized mail', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('SELECT id, mail, active')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 9,
            mail: 'person@example.com',
            active: true,
            email_confirmed: true
          }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    mailMock.sendPasswordResetEmail.mock.mockImplementationOnce(() => Promise.resolve());

    const res = await supertest(app)
      .post('/forgot')
      .set('Accept-Language', 'es-CL,es;q=0.9')
      .send({
        email: 'PERSON@example.com',
        recaptcha_token: 'valid_token'
      });

    assert.strictEqual(res.status, 200);

    const deleteCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('DELETE FROM pass_reset'));
    const insertCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('INSERT INTO pass_reset'));
    assert.deepStrictEqual(deleteCall.arguments[1], ['person@example.com', 'password_reset']);
    assert.strictEqual(insertCall.arguments[1][0], 'person@example.com');
    assert.match(insertCall.arguments[1][1], /^[a-f0-9]{64}$/);
    assert.strictEqual(insertCall.arguments[1][2], 'password_reset');

    assert.strictEqual(mailMock.sendPasswordResetEmail.mock.calls.length, 1);
    const mailArgs = mailMock.sendPasswordResetEmail.mock.calls[0].arguments[0];
    assert.strictEqual(mailArgs.to, 'person@example.com');
    assert.match(mailArgs.rawToken, /^[a-f0-9]{64}$/);
    assert.strictEqual(sha256Hex(mailArgs.rawToken), insertCall.arguments[1][1]);
    assert.strictEqual(mailArgs.preferredLocale, 'es_CL');
  });

  test('POST /reset-password - rejects invalid or expired tokens', async () => {
    passwordResetMock.findValidTokenMail.mock.mockImplementationOnce(() => Promise.resolve(null));

    const res = await supertest(app)
      .post('/reset-password')
      .send({
        token: 'expired-token',
        password: 'FreshPassword123!@',
        password_confirmation: 'FreshPassword123!@'
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Token is invalid or has expired');
    assert.deepStrictEqual(passwordResetMock.findValidTokenMail.mock.calls[0].arguments[0], {
      tokenDigest: sha256Hex('expired-token'),
      ttlMinutes: 60
    });
    assert.strictEqual(passwordResetMock.resetPassword.mock.callCount(), 0);
  });

  test('POST /reset-password - updates password and consumes reset token', async () => {
    passwordResetMock.findValidTokenMail.mock.mockImplementationOnce(() => Promise.resolve('person@example.com'));
    passwordResetMock.resetPassword.mock.mockImplementationOnce(() => Promise.resolve(null));

    const res = await supertest(app)
      .post('/reset-password')
      .send({
        token: 'valid-token',
        password: 'FreshPassword123!@',
        password_confirmation: 'FreshPassword123!@'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'Password updated successfully');

    const [{ tokenDigest, ttlMinutes, passwordHash }] = passwordResetMock.resetPassword.mock.calls[0].arguments;
    assert.strictEqual(tokenDigest, sha256Hex('valid-token'));
    assert.strictEqual(ttlMinutes, 60);
    assert.strictEqual(await bcrypt.compare('FreshPassword123!@', passwordHash), true);
  });

  test('POST /reset-password - refuses a token revoked while the password was hashed', async () => {
    passwordResetMock.findValidTokenMail.mock.mockImplementationOnce(() => Promise.resolve('person@example.com'));
    passwordResetMock.resetPassword.mock.mockImplementationOnce(() => Promise.resolve('invalidOrExpiredToken'));

    const res = await supertest(app)
      .post('/reset-password')
      .set('Accept-Language', 'es-CL')
      .send({
        token: 'revoked-token',
        password: 'FreshPassword123!@',
        password_confirmation: 'FreshPassword123!@'
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'El token es inválido o ha expirado');
  });

  test('POST /admin/change-password - updates administrator password after current password verification', async () => {
    const currentPasswordHash = await bcrypt.hash('CurrentPassword123!@', 1);
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('SELECT id, mail, password_bcrypt')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 7,
            mail: 'admin@example.com',
            password_bcrypt: currentPasswordHash,
            firstname: 'Ada',
            lastname: 'Admin'
          }]
        });
      }

      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    const res = await supertest(app)
      .post('/admin/change-password')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .send({
        current_password: 'CurrentPassword123!@',
        new_password: 'FreshPassword123!@',
        password_confirmation: 'FreshPassword123!@'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'Password updated successfully');

    const updateCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('UPDATE users'));
    assert.ok(updateCall);
    assert.strictEqual(await bcrypt.compare('FreshPassword123!@', updateCall.arguments[1][0]), true);
    assert.strictEqual(updateCall.arguments[1][1], 7);
    assert.match(updateCall.arguments[0], /session_version = session_version \+ 1/);
  });

  test('POST /admin/change-password - rejects weak new passwords before database access', async () => {
    const res = await supertest(app)
      .post('/admin/change-password')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .send({
        current_password: 'CurrentPassword123!@',
        new_password: 'weak',
        password_confirmation: 'weak'
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Password must be at least 10 characters long and contain at least 2 symbols');
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  test('GET /admin/passkeys - lists passkeys for the authenticated administrator', async () => {
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [{
        id: 4,
        name: 'Touch ID',
        credential_device_type: 'multiDevice',
        credential_backed_up: true,
        transports: ['internal'],
        created_at: '2026-05-30T10:00:00.000Z',
        last_used_at: null
      }]
    }));

    const res = await supertest(app)
      .get('/admin/passkeys')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      passkeys: [{
        id: 4,
        name: 'Touch ID',
        credential_device_type: 'multiDevice',
        credential_backed_up: true,
        transports: ['internal'],
        created_at: '2026-05-30T10:00:00.000Z',
        last_used_at: null
      }]
    });
    assert.deepStrictEqual(dbMock.query.mock.calls[0].arguments[1], [7]);
  });

  test('POST /admin/passkeys/registration-options - verifies password and returns WebAuthn options', async () => {
    const currentPasswordHash = await bcrypt.hash('CurrentPassword123!@', 1);
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('SELECT id, mail, password_bcrypt')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 7,
            mail: 'admin@example.com',
            password_bcrypt: currentPasswordHash,
            firstname: 'Ada',
            lastname: 'Admin'
          }]
        });
      }

      if (queryStr.includes('SELECT credential_id, transports')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            credential_id: 'existing-credential',
            transports: ['usb']
          }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });
    simpleWebAuthnServerMock.generateRegistrationOptions.mock.mockImplementationOnce(() => Promise.resolve({
      challenge: 'challenge-123',
      rp: {
        name: 'EthicApp',
        id: '127.0.0.1'
      }
    }));

    const res = await supertest(app)
      .post('/admin/passkeys/registration-options')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .set('Origin', 'http://127.0.0.1')
      .send({
        password: 'CurrentPassword123!@'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.challenge, 'challenge-123');
    assert.strictEqual(simpleWebAuthnServerMock.generateRegistrationOptions.mock.calls.length, 1);

    const options = simpleWebAuthnServerMock.generateRegistrationOptions.mock.calls[0].arguments[0];
    assert.strictEqual(options.rpID, '127.0.0.1');
    assert.strictEqual(options.userName, 'admin@example.com');
    assert.strictEqual(options.userDisplayName, 'Ada Admin');
    assert.deepStrictEqual(options.excludeCredentials, [{
      id: 'existing-credential',
      transports: ['usb']
    }]);
  });

  test('POST /admin/passkeys/authentication-options - returns allowed passkeys', async () => {
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [{
        credential_id: 'credential-123',
        transports: ['internal']
      }]
    }));
    simpleWebAuthnServerMock.generateAuthenticationOptions.mock.mockImplementationOnce(() => Promise.resolve({
      challenge: 'auth-challenge-123',
      allowCredentials: [{
        id: 'credential-123',
        transports: ['internal']
      }]
    }));

    const res = await supertest(app)
      .post('/admin/passkeys/authentication-options')
      .set('X-Test-User-Id', '7')
      .set('X-Test-User-Role', 'S')
      .set('Origin', 'http://127.0.0.1')
      .send({});

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.challenge, 'auth-challenge-123');

    const options = simpleWebAuthnServerMock.generateAuthenticationOptions.mock.calls[0].arguments[0];
    assert.strictEqual(options.rpID, '127.0.0.1');
    assert.deepStrictEqual(options.allowCredentials, [{
      id: 'credential-123',
      transports: ['internal']
    }]);
  });
});

describe('Password policy (#889)', () => {
  const WEAK_EN = 'Password must be at least 10 characters long and contain at least 2 symbols';
  const WEAK_ES = 'La contraseña debe tener al menos 10 caracteres y al menos 2 símbolos';

  beforeEach(() => {
    dbMock.query.mock.resetCalls();
    dbMock.query.mock.restore();
    passwordResetMock.findValidTokenMail.mock.resetCalls();
    passwordResetMock.resetPassword.mock.resetCalls();
    recaptchaMock.verifyRecaptchaToken.mock.resetCalls();
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementation(() => Promise.resolve(true));
  });

  test('GET /password-policy - returns the limits the routes enforce', async () => {
    const res = await supertest(app).get('/password-policy');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { minLength: 10, minSymbols: 2 });
    assert.match(res.headers['cache-control'], /public/);
    assert.strictEqual(dbMock.query.mock.calls.length, 0);
  });

  // Every route that sets a password refuses one just below either limit,
  // with the same localized message.
  const routes = [
    {
      name: 'POST /register',
      path: '/register',
      payload: (password) => validRegistrationPayload({ password, password_confirmation: password })
    },
    {
      name: 'POST /register-prof',
      path: '/register-prof',
      admin: true,
      payload: (password) => validProfessorPayload({ password, password_confirmation: password })
    },
    {
      name: 'POST /reset-password',
      path: '/reset-password',
      payload: (password) => ({ token: 'raw-token', password, password_confirmation: password })
    },
    {
      name: 'POST /admin/change-password',
      path: '/admin/change-password',
      admin: true,
      payload: (password) => ({
        current_password: 'CurrentPassword123!@',
        new_password: password,
        password_confirmation: password
      })
    }
  ];

  for (const route of routes) {
    for (const [label, password] of [['nine characters', 'abcdefg!!'], ['one symbol', 'abcdefghi!']]) {
      for (const [language, message] of [['en-US', WEAK_EN], ['es-CL', WEAK_ES]]) {
        test(`${route.name} - refuses a password with ${label} (${language})`, async () => {
          let request = supertest(app).post(route.path).set('Accept-Language', language);
          if (route.admin) {
            request = request.set('X-Test-User-Id', '7').set('X-Test-User-Role', 'S');
          }

          const res = await request.send(route.payload(password));

          assert.strictEqual(res.status, 400);
          assert.strictEqual(res.body.error, message);
          assert.strictEqual(dbMock.query.mock.calls.length, 0);
        });
      }
    }
  }
});
