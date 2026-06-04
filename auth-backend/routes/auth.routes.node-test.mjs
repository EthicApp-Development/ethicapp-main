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
const simpleWebAuthnServerMock = {
  generateAuthenticationOptions: mock.fn(),
  generateRegistrationOptions: mock.fn(),
  verifyAuthenticationResponse: mock.fn(),
  verifyRegistrationResponse: mock.fn()
};

mock.module('../config/database.js', { defaultExport: dbMock });
mock.module('../services/recaptcha.service.js', { defaultExport: recaptchaMock });
mock.module('../services/mail.service.js', { defaultExport: mailMock });
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
    rut: 'testuser',
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
    dni: '12345678-9',
    gender: 'M',
    email: 'john@example.com',
    password: 'StrongPassword123!@',
    password_confirmation: 'StrongPassword123!@',
    recaptcha_token: 'valid_token',
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
      .send({ username: 'testuser', password: 'password123' });

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
      .send({ username: 'testuser', password: 'password123' });

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
      .send({ username: 'testuser', password: 'password123' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.redirectTo, '/mng');
    assert.strictEqual(dbMock.query.mock.calls.length, 2);

    const updateCall = dbMock.query.mock.calls[1];
    assert.match(updateCall.arguments[0], /UPDATE users\s+SET last_login_at = NOW\(\)\s+WHERE id = \$1/);
    assert.deepStrictEqual(updateCall.arguments[1], [1]);
  });

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
      rows: [{
        id: 7,
        mail: 'john@example.com',
        rut: '11111111-1'
      }]
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

  test('POST /register - duplicate identifier returns a stable error code', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({
      rowCount: 1,
      rows: [{
        id: 7,
        mail: 'other@example.com',
        rut: '12345678-9'
      }]
    }));

    const res = await supertest(app)
      .post('/register')
      .send(validRegistrationPayload());

    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'duplicate_user_identifier');
  });

  test('POST /register - valid registration stores inactive pending account and sends confirmation mail', async () => {
    recaptchaMock.verifyRecaptchaToken.mock.mockImplementationOnce(() => Promise.resolve(true));
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('SELECT id, mail, rut')) {
        return Promise.resolve({ rowCount: 0, rows: [] });
      }
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
    assert.deepStrictEqual(insertCall.arguments[1].slice(0, 8), [
      'John',
      'Doe',
      'John Doe',
      '12345678-9',
      'M',
      'john@example.com',
      'A',
      'es_CL'
    ]);
    assert.strictEqual(await bcrypt.compare('StrongPassword123!@', insertCall.arguments[1][8]), true);
    assert.strictEqual(insertCall.arguments[1][9], 'local');

    const insertSql = insertCall.arguments[0];
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
      if (queryStr.includes('SELECT id, mail, rut')) {
        return Promise.resolve({ rowCount: 0, rows: [] });
      }
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
    dbMock.query.mock.mockImplementationOnce(() => Promise.resolve({ rowCount: 0, rows: [] }));

    const res = await supertest(app)
      .post('/reset-password')
      .send({
        token: 'expired-token',
        password: 'FreshPassword123!@',
        password_confirmation: 'FreshPassword123!@'
      });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Token is invalid or has expired');
    assert.deepStrictEqual(dbMock.query.mock.calls[0].arguments[1], [sha256Hex('expired-token'), 60]);
  });

  test('POST /reset-password - updates password and consumes reset token', async () => {
    dbMock.query.mock.mockImplementation((queryStr) => {
      if (queryStr.includes('FROM pass_reset')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ mail: 'person@example.com' }]
        });
      }

      if (queryStr.includes('FROM users')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: 9, active: false, email_confirmed: false }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const res = await supertest(app)
      .post('/reset-password')
      .send({
        token: 'valid-token',
        password: 'FreshPassword123!@',
        password_confirmation: 'FreshPassword123!@'
      });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.message, 'Password updated successfully');

    const updateCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('UPDATE users'));
    const deleteCall = dbMock.query.mock.calls.find((call) => call.arguments[0].includes('DELETE FROM pass_reset'));
    assert.strictEqual(await bcrypt.compare('FreshPassword123!@', updateCall.arguments[1][0]), true);
    assert.strictEqual(updateCall.arguments[1][1], 9);
    assert.deepStrictEqual(deleteCall.arguments[1], ['person@example.com']);
    assert.match(updateCall.arguments[0], /active = CASE WHEN email_confirmed = false THEN true ELSE active END/);
    assert.match(updateCall.arguments[0], /email_confirmed = true/);
    assert.match(updateCall.arguments[0], /session_version = session_version \+ 1/);
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
