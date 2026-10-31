// Integration tests for an administrator setting a user's password (#889),
// against a real PostgreSQL database with migrations V1 to V12 or later
// applied (users.session_version is V11, anonymized_at V12).
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts and tokens that are not
// removed.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import pg from 'pg';
import supertest from 'supertest';

import { createAdminUserPasswordRouter } from './admin-user-password.routes.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

const INTERNAL_TOKEN = 'integration-internal-service-token';
process.env.AUTH_INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;

const NEW_PASSWORD = 'Temporary-Pass!42';
const OLD_HASH = '$2b$04$abcdefghijklmnopqrstuuMlB3GHn5hYqZIt4P3pBbQS/1D6k6Hka';

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

async function insertUser({ role = 'A', active = true, emailConfirmed = true, anonymized = false } = {}) {
  const mail = `it-889-${randomUUID()}@example.com`;
  const [row] = await query(
    `
      INSERT INTO users
        (name, rut, mail, role, pass, password_bcrypt, active, email_confirmed, anonymized_at)
      VALUES
        ('Integration User', $1, $2, $3, 'legacy-md5', $4, $5, $6, CASE WHEN $7 THEN NOW() END)
      RETURNING id, mail
    `,
    [randomUUID(), mail, role, OLD_HASH, active, emailConfirmed, anonymized]
  );
  return row;
}

async function insertToken(mail, purpose) {
  await query(
    `
      INSERT INTO pass_reset (mail, token, ctime, token_purpose)
      VALUES ($1, $2, NOW(), $3)
    `,
    [mail, randomUUID().replaceAll('-', ''), purpose]
  );
}

async function userRow(id) {
  const [row] = await query(
    `
      SELECT mail, pass, password_bcrypt, session_version, active, email_confirmed
      FROM users
      WHERE id = $1
    `,
    [id]
  );
  return row;
}

async function tokenPurposes(mail) {
  const rows = await query(
    'SELECT token_purpose FROM pass_reset WHERE lower(mail) = lower($1) ORDER BY token_purpose',
    [mail]
  );
  return rows.map((row) => row.token_purpose);
}

function app(adminId) {
  const application = express();
  application.use(express.json());
  application.use((req, res, next) => {
    req.user = { id: adminId, role: 'S' };
    req.isAuthenticated = () => true;
    next();
  });
  application.use('/', createAdminUserPasswordRouter({ pool: getPool(), logger: { error: () => {} } }));
  return application;
}

function setPassword(application, userId, body) {
  return supertest(application)
    .post(`/admin/users/${userId}/password`)
    .set('X-Internal-Service-Token', INTERNAL_TOKEN)
    .send({ new_password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD, ...body });
}

test('sets the password of a pending student: hash, legacy column, sessions and reset tokens', { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });
  const student = await insertUser({ active: false, emailConfirmed: false });
  const other = await insertUser();
  await insertToken(student.mail, 'password_reset');
  await insertToken(student.mail.toUpperCase(), 'password_reset');
  await insertToken(student.mail, 'account_confirmation');
  await insertToken(other.mail, 'password_reset');
  const before = await userRow(student.id);

  const res = await setPassword(app(admin.id), student.id, { expected_email: student.mail });

  assert.equal(res.status, 200);
  const after = await userRow(student.id);
  assert.equal(await bcrypt.compare(NEW_PASSWORD, after.password_bcrypt), true);
  assert.equal(after.pass, null);
  assert.equal(after.session_version, before.session_version + 1);
  // Activation is left to the confirmation action (#874).
  assert.equal(after.active, false);
  assert.equal(after.email_confirmed, false);
  assert.deepEqual(await tokenPurposes(student.mail), ['account_confirmation']);
  assert.deepEqual(await tokenPurposes(other.mail), ['password_reset']);
});

test('sets the password of a teacher', { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });
  const teacher = await insertUser({ role: 'P' });

  const res = await setPassword(app(admin.id), teacher.id, { expected_email: teacher.mail });

  assert.equal(res.status, 200);
  assert.equal(await bcrypt.compare(NEW_PASSWORD, (await userRow(teacher.id)).password_bcrypt), true);
});

for (const [label, options, code] of [
  ['an administrator account', { role: 'S' }, 'ROLE_NOT_ALLOWED'],
  ['an anonymized account', { anonymized: true }, 'ACCOUNT_ANONYMIZED']
]) {
  test(`refuses ${label} and changes nothing`, { skip: SKIP_REASON }, async () => {
    const admin = await insertUser({ role: 'S' });
    const target = await insertUser(options);
    await insertToken(target.mail, 'password_reset');
    const before = await userRow(target.id);

    const res = await setPassword(app(admin.id), target.id, { expected_email: target.mail });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, code);
    assert.deepEqual(await userRow(target.id), before);
    assert.deepEqual(await tokenPurposes(target.mail), ['password_reset']);
  });
}

test('refuses a changed email and changes nothing', { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });
  const student = await insertUser();
  const before = await userRow(student.id);

  const res = await setPassword(app(admin.id), student.id, { expected_email: 'previous@example.com' });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'ACCOUNT_CHANGED');
  assert.deepEqual(await userRow(student.id), before);
});

test('answers 404 for a missing account', { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });

  const res = await setPassword(app(admin.id), 2147483000, { expected_email: 'nobody@example.com' });

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'USER_NOT_FOUND');
});

test('two concurrent settings both apply, one after the other', { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });
  const student = await insertUser();
  const before = await userRow(student.id);
  const application = app(admin.id);

  const results = await Promise.all([
    setPassword(application, student.id, { expected_email: student.mail }),
    setPassword(application, student.id, { expected_email: student.mail })
  ]);

  assert.deepEqual(results.map((res) => res.status), [200, 200]);
  assert.equal((await userRow(student.id)).session_version, before.session_version + 2);
});
