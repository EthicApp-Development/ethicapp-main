// Integration tests for an administrator creating an account (#1170),
// against a real PostgreSQL database with every migration applied
// (users.created_at is V28, users_mail_lower_unique V42).
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts that are not removed.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import pg from 'pg';
import supertest from 'supertest';

import { createAdminUserAccountRouter } from './admin-user-account.routes.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

const INTERNAL_TOKEN = 'integration-internal-service-token';
process.env.AUTH_INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;

const PASSWORD = 'Temporary-Pass!42';

let pool = null;

function getPool() {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  return pool;
}

async function query(sql, params = []) {
  return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
  await pool?.end();
});

function app(welcomeCalls) {
  const application = express();
  application.use(express.json());
  application.use((req, res, next) => {
    req.user = { id: 1, role: 'S' };
    req.isAuthenticated = () => true;
    next();
  });
  application.use('/', createAdminUserAccountRouter({
    pool: getPool(),
    logger: { error: () => {} },
    sendWelcomeEmail: async (message) => {
      welcomeCalls.push(message);
    }
  }));
  return application;
}

function createAccount(application, body) {
  return supertest(application)
    .post('/admin/users')
    .set('X-Internal-Service-Token', INTERNAL_TOKEN)
    .send({
      firstname: 'Integration',
      lastname: 'Teacher',
      gender: 'O',
      role: 'P',
      preferred_locale: 'es_CL',
      password: PASSWORD,
      password_confirmation: PASSWORD,
      ...body
    });
}

test('creates an active, confirmed teacher who can sign in with the password', { skip: SKIP_REASON }, async () => {
  const welcomeCalls = [];
  const email = `it-1170-${randomUUID()}@example.com`;

  const res = await createAccount(app(welcomeCalls), { email: email.toUpperCase() });

  assert.equal(res.status, 201);
  assert.equal(res.body.welcome_email_sent, true);
  const [row] = await query(
    `
      SELECT firstname, lastname, name, sex, mail, role, preferred_locale,
             password_bcrypt, pass, auth_provider, active, email_confirmed,
             anonymized_at, last_login_at, created_at
      FROM users
      WHERE id = $1
    `,
    [res.body.id]
  );

  assert.equal(row.firstname, 'Integration');
  assert.equal(row.lastname, 'Teacher');
  assert.equal(row.name, 'Integration Teacher');
  assert.equal(row.sex, 'O');
  assert.equal(row.mail, email);
  assert.equal(row.role, 'P');
  assert.equal(row.preferred_locale, 'es_CL');
  assert.equal(await bcrypt.compare(PASSWORD, row.password_bcrypt), true);
  assert.equal(row.pass, null);
  assert.equal(row.auth_provider, 'local');
  assert.equal(row.active, true);
  assert.equal(row.email_confirmed, true);
  assert.equal(row.anonymized_at, null);
  assert.equal(row.last_login_at, null);
  assert.ok(row.created_at instanceof Date);

  const tokens = await query('SELECT 1 FROM pass_reset WHERE lower(mail) = lower($1)', [email]);
  assert.equal(tokens.length, 0);
  assert.deepEqual(welcomeCalls, [{ to: email, firstname: 'Integration', preferredLocale: 'es_CL' }]);
});

test('refuses an email already registered in another letter case', { skip: SKIP_REASON }, async () => {
  const welcomeCalls = [];
  const email = `it-1170-${randomUUID()}@example.com`;
  const application = app(welcomeCalls);

  const first = await createAccount(application, { email, role: 'A' });
  const second = await createAccount(application, { email: email.toUpperCase(), role: 'P' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'EMAIL_ALREADY_REGISTERED');
  const rows = await query('SELECT id, role FROM users WHERE lower(mail) = lower($1)', [email]);
  assert.deepEqual(rows, [{ id: first.body.id, role: 'A' }]);
  assert.equal(welcomeCalls.length, 1);
});
