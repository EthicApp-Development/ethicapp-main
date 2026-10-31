// Integration tests for password recovery's database work (POST
// /reset-password) and how it orders with an administrator setting the
// password (#889), against a real PostgreSQL database with migrations V1 to
// V12 or later applied. Lock waits cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts and tokens that are not
// removed.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import pg from 'pg';
import supertest from 'supertest';

import { createAdminUserPasswordRouter } from '../routes/admin-user-password.routes.js';
import { createPasswordResetService, RESET_PASSWORD_REFUSALS } from './password-reset.service.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

const INTERNAL_TOKEN = 'integration-internal-service-token';
process.env.AUTH_INTERNAL_SERVICE_TOKEN = INTERNAL_TOKEN;

const TTL_MINUTES = 60;
const ADMIN_PASSWORD = 'Operator-Set!42';
const RECOVERY_PASSWORD = 'Recovered-Pass!42';
const OLD_HASH = '$2b$04$abcdefghijklmnopqrstuuMlB3GHn5hYqZIt4P3pBbQS/1D6k6Hka';

let pool = null;
let recoveryHash = null;

function getPool() {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
  return pool;
}

async function query(sql, params = []) {
  return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
  await pool?.end();
});

function service() {
  return createPasswordResetService({ pool: getPool(), logger: { error: () => {} } });
}

async function hashOfRecovery() {
  recoveryHash ??= await bcrypt.hash(RECOVERY_PASSWORD, 4);
  return recoveryHash;
}

async function insertUser({ role = 'A', active = true, emailConfirmed = true } = {}) {
  const mail = `it-889r-${randomUUID()}@example.com`;
  const [row] = await query(
    `
      INSERT INTO users (name, rut, mail, role, password_bcrypt, active, email_confirmed)
      VALUES ('Integration User', $1, $2, $3, $4, $5, $6)
      RETURNING id, mail
    `,
    [randomUUID(), mail, role, OLD_HASH, active, emailConfirmed]
  );
  return row;
}

// A recovery token as the forgot-password route stores it (its digest).
async function insertResetToken(mail) {
  const digest = randomUUID().replaceAll('-', '');
  await query(
    "INSERT INTO pass_reset (mail, token, ctime, token_purpose) VALUES ($1, $2, NOW(), 'password_reset')",
    [mail, digest]
  );
  return digest;
}

async function userRow(id) {
  const [row] = await query(
    'SELECT password_bcrypt, session_version, active, email_confirmed FROM users WHERE id = $1',
    [id]
  );
  return row;
}

async function resetTokenCount(mail) {
  const [row] = await query(
    "SELECT count(*)::integer AS n FROM pass_reset WHERE lower(mail) = lower($1) AND token_purpose = 'password_reset'",
    [mail]
  );
  return row.n;
}

function adminApp(adminId) {
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

function adminSetsPassword(adminId, user) {
  return supertest(adminApp(adminId))
    .post(`/admin/users/${user.id}/password`)
    .set('X-Internal-Service-Token', INTERNAL_TOKEN)
    .send({ new_password: ADMIN_PASSWORD, password_confirmation: ADMIN_PASSWORD, expected_email: user.mail });
}

async function waitUntilBlockedOnLock(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid]);
    if (row?.wait_event_type === 'Lock') {
      return;
    }
    await delay(50);
  }
  throw new Error(`backend ${pid} never waited for a lock`);
}

test('recovery stores the password, confirms a pending sign-up and consumes the tokens', { skip: SKIP_REASON }, async () => {
  const user = await insertUser({ active: false, emailConfirmed: false });
  const token = await insertResetToken(user.mail);
  await insertResetToken(user.mail.toUpperCase());
  const before = await userRow(user.id);

  assert.equal(await service().findValidTokenMail({ tokenDigest: token, ttlMinutes: TTL_MINUTES }), user.mail);
  assert.equal(await service().resetPassword({ tokenDigest: token, ttlMinutes: TTL_MINUTES, passwordHash: await hashOfRecovery() }), null);

  const after = await userRow(user.id);
  assert.equal(await bcrypt.compare(RECOVERY_PASSWORD, after.password_bcrypt), true);
  assert.equal(after.session_version, before.session_version + 1);
  assert.equal(after.active, true);
  assert.equal(after.email_confirmed, true);
  assert.equal(await resetTokenCount(user.mail), 0);
});

test('a recovery that checked its token before an administrator set the password is refused', { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });
  const user = await insertUser();
  const token = await insertResetToken(user.mail);

  // The recovery checks its link, then hashes the password...
  assert.equal(await service().findValidTokenMail({ tokenDigest: token, ttlMinutes: TTL_MINUTES }), user.mail);
  // ...while the administrator sets one, which revokes the link.
  assert.equal((await adminSetsPassword(admin.id, user)).status, 200);

  const refusal = await service().resetPassword({ tokenDigest: token, ttlMinutes: TTL_MINUTES, passwordHash: await hashOfRecovery() });

  assert.equal(refusal, RESET_PASSWORD_REFUSALS.invalidOrExpiredToken);
  const after = await userRow(user.id);
  assert.equal(await bcrypt.compare(ADMIN_PASSWORD, after.password_bcrypt), true, "the administrator's password stays");
});

test("a recovery waiting for the account while an administrator's change commits is refused", { skip: SKIP_REASON }, async () => {
  const user = await insertUser();
  const token = await insertResetToken(user.mail);
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);

  // The administrator's transaction, as admin-user-password.routes.js runs
  // it, holds the account when the recovery arrives.
  const adminClient = await getPool().connect();
  await adminClient.query('BEGIN');
  await adminClient.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);

  // Run the recovery on a connection whose pid the test can watch.
  const watched = {
    connect: async () => {
      const client = await getPool().connect();
      const [{ pid: own }] = (await client.query('SELECT pg_backend_pid() AS pid')).rows;
      watched.pid = own;
      return client;
    }
  };
  const pending = createPasswordResetService({ pool: watched, logger: { error: () => {} } })
    .resetPassword({ tokenDigest: token, ttlMinutes: TTL_MINUTES, passwordHash: await hashOfRecovery() });
  while (!watched.pid) {
    await delay(10);
  }
  await waitUntilBlockedOnLock(watched.pid);

  await adminClient.query('UPDATE users SET password_bcrypt = $1, session_version = session_version + 1 WHERE id = $2', [adminHash, user.id]);
  await adminClient.query("DELETE FROM pass_reset WHERE lower(mail) = lower($1) AND token_purpose = 'password_reset'", [user.mail]);
  await adminClient.query('COMMIT');
  adminClient.release();

  assert.equal(await pending, RESET_PASSWORD_REFUSALS.invalidOrExpiredToken);
  assert.equal(await bcrypt.compare(ADMIN_PASSWORD, (await userRow(user.id)).password_bcrypt), true);
});

test("a recovery that completes first is replaced by the administrator's password", { skip: SKIP_REASON }, async () => {
  const admin = await insertUser({ role: 'S' });
  const user = await insertUser();
  const token = await insertResetToken(user.mail);

  assert.equal(await service().resetPassword({ tokenDigest: token, ttlMinutes: TTL_MINUTES, passwordHash: await hashOfRecovery() }), null);
  assert.equal((await adminSetsPassword(admin.id, user)).status, 200);

  assert.equal(await bcrypt.compare(ADMIN_PASSWORD, (await userRow(user.id)).password_bcrypt), true);
});

test('two recoveries with the same link: one stores its password, the other is refused', { skip: SKIP_REASON }, async () => {
  const user = await insertUser();
  const token = await insertResetToken(user.mail);
  const hash = await hashOfRecovery();

  const results = await Promise.all([
    service().resetPassword({ tokenDigest: token, ttlMinutes: TTL_MINUTES, passwordHash: hash }),
    service().resetPassword({ tokenDigest: token, ttlMinutes: TTL_MINUTES, passwordHash: hash })
  ]);

  assert.deepEqual(results.sort(), [null, RESET_PASSWORD_REFUSALS.invalidOrExpiredToken].sort());
});
