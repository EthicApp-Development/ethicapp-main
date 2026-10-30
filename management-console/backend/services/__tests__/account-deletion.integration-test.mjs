// Integration tests for the deletion of a never-activated account (#875),
// against a real PostgreSQL database with migrations V1-V28 or later applied.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts, sessions and audit
// events that are not removed.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { createAccountDeletionService } from '../account-deletion.service.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

const ADMIN_USER_ID = 1;
const silentLogger = { error: () => {} };

let pool = null;

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

const NEVER_ACTIVATED = Object.freeze({ active: false, emailConfirmed: false });

async function insertUser({ active, emailConfirmed, anonymized = false, signedIn = false }, mail = null) {
  const [row] = await query(
    `
      INSERT INTO users (name, rut, mail, role, active, email_confirmed, anonymized_at, last_login_at)
      VALUES (
        'Integration Student', $1, $2, 'A', $3, $4,
        CASE WHEN $5 THEN NOW() END,
        CASE WHEN $6 THEN NOW() END
      )
      RETURNING id, mail
    `,
    [randomUUID(), mail || `it-875-${randomUUID()}@example.com`, active, emailConfirmed, anonymized, signedIn]
  );
  return { id: row.id, mail: row.mail };
}

async function insertToken(mail, purpose) {
  await query(
    'INSERT INTO pass_reset (mail, token, ctime, token_purpose) VALUES ($1, $2, NOW(), $3)',
    [mail, randomUUID().replaceAll('-', ''), purpose]
  );
}

async function insertSessionParticipant(executor, userId) {
  const { rows: [session] } = await executor.query(
    "INSERT INTO sessions (name) VALUES ('Integration session') RETURNING id"
  );
  await executor.query('INSERT INTO sesusers (sesid, uid) VALUES ($1, $2)', [session.id, userId]);
}

async function auditEventsFor(userId) {
  return query(
    `
      SELECT admin_user_id, action, target_user_id, outcome, reason_code
      FROM admin_audit_events
      WHERE target_user_id = $1 AND action = 'account.delete'
      ORDER BY id
    `,
    [userId]
  );
}

async function userExists(userId) {
  return (await query('SELECT 1 FROM users WHERE id = $1', [userId])).length === 1;
}

function service() {
  return createAccountDeletionService({ pool: getPool(), logger: silentLogger });
}

test('#875: a never-activated account is deleted with its tokens and passkeys, and its email can sign up again', {
  skip: SKIP_REASON
}, async () => {
  const user = await insertUser(NEVER_ACTIVATED);
  await insertToken(user.mail.toUpperCase(), 'account_confirmation');
  await insertToken(user.mail, 'password_reset');
  await query(
    "INSERT INTO user_passkeys (user_id, credential_id, credential_public_key) VALUES ($1, $2, '\\x00')",
    [user.id, randomUUID()]
  );

  const result = await service().deleteNeverActivatedAccount({
    adminUserId: ADMIN_USER_ID,
    userId: user.id,
    expectedEmail: ` ${user.mail.toUpperCase()} `
  });

  assert.deepEqual(result, { id: user.id, deleted: true });
  assert.equal(await userExists(user.id), false);
  assert.deepEqual(await query('SELECT id FROM pass_reset WHERE lower(mail) = lower($1)', [user.mail]), []);
  assert.deepEqual(await query('SELECT id FROM user_passkeys WHERE user_id = $1', [user.id]), []);
  assert.deepEqual(await auditEventsFor(user.id), [{
    admin_user_id: ADMIN_USER_ID,
    action: 'account.delete',
    target_user_id: user.id,
    outcome: 'succeeded',
    reason_code: null
  }]);

  const again = await insertUser(NEVER_ACTIVATED, user.mail);
  assert.notEqual(again.id, user.id);
});

test('#875: accounts that were ever active, signed in or anonymized are refused, unchanged, and the refusal is recorded', {
  skip: SKIP_REASON
}, async () => {
  for (const [state, expectedStatus] of [
    [{ active: true, emailConfirmed: true }, 'active'],
    [{ active: false, emailConfirmed: true }, 'inactive'],
    [{ ...NEVER_ACTIVATED, anonymized: true }, 'anonymized'],
    [{ ...NEVER_ACTIVATED, signedIn: true }, 'pending']
  ]) {
    const user = await insertUser(state);
    await insertToken(user.mail, 'account_confirmation');

    await assert.rejects(
      service().deleteNeverActivatedAccount({ adminUserId: ADMIN_USER_ID, userId: user.id, expectedEmail: user.mail }),
      { code: 'ACCOUNT_NOT_DELETABLE', accountStatus: expectedStatus }
    );

    assert.equal(await userExists(user.id), true);
    assert.equal((await query('SELECT id FROM pass_reset WHERE mail = $1', [user.mail])).length, 1);
    assert.deepEqual(
      (await auditEventsFor(user.id)).map((event) => [event.outcome, event.reason_code]),
      [['refused', 'ACCOUNT_NOT_DELETABLE']]
    );
  }
});

test('#875: an account is not deleted for another email than its own', { skip: SKIP_REASON }, async () => {
  const user = await insertUser(NEVER_ACTIVATED);

  await assert.rejects(
    service().deleteNeverActivatedAccount({
      adminUserId: ADMIN_USER_ID,
      userId: user.id,
      expectedEmail: 'edited-but-unsaved@example.test'
    }),
    { code: 'ACCOUNT_CHANGED' }
  );

  assert.equal(await userExists(user.id), true);
  assert.deepEqual(
    (await auditEventsFor(user.id)).map((event) => [event.outcome, event.reason_code]),
    [['refused', 'ACCOUNT_CHANGED']]
  );
});

test('#875: referenced accounts are refused, naming the table, with and without a foreign key', {
  skip: SKIP_REASON
}, async () => {
  const cases = [
    ['sesusers', 'activities', (userId) => insertSessionParticipant(getPool(), userId)],
    ['ethical_cases', 'authoredContent', (userId) => query(
      "INSERT INTO ethical_cases (title, pdf_path, creator) VALUES ('Integration case', 'it-875.pdf', $1)",
      [userId]
    )],
    ['student_anonymization_events', 'administration', async (userId) => {
      const [run] = await query('INSERT INTO student_anonymization_runs DEFAULT VALUES RETURNING id');
      await query(
        "INSERT INTO student_anonymization_events (run_id, user_id, status) VALUES ($1, $2, 'skipped')",
        [run.id, userId]
      );
    }],
    ['external_service_jobs', 'aiServices', (userId) => query(
      "INSERT INTO external_service_jobs (service_id, hook_name, user_id) VALUES ('it-875', 'it-875', $1)",
      [userId]
    )]
  ];

  for (const [table, category, reference] of cases) {
    const user = await insertUser(NEVER_ACTIVATED);
    await reference(user.id);

    await assert.rejects(
      service().deleteNeverActivatedAccount({ adminUserId: ADMIN_USER_ID, userId: user.id, expectedEmail: user.mail }),
      { code: 'ACCOUNT_REFERENCED', referencedBy: table, referenceCategory: category }
    );

    assert.equal(await userExists(user.id), true, table);
    assert.deepEqual(
      (await auditEventsFor(user.id)).map((event) => [event.outcome, event.reason_code]),
      [['refused', `REFERENCED_BY_${table.toUpperCase()}`]]
    );
  }
});

test('#875: a reference inserted while the deletion waits for the account is seen, not lost', {
  skip: SKIP_REASON
}, async () => {
  const user = await insertUser(NEVER_ACTIVATED);
  const client = await getPool().connect();

  try {
    // The insert locks the account row (FOR KEY SHARE) until it commits.
    await client.query('BEGIN');
    await insertSessionParticipant(client, user.id);

    const deletion = service().deleteNeverActivatedAccount({
      adminUserId: ADMIN_USER_ID,
      userId: user.id,
      expectedEmail: user.mail
    });
    const outcome = deletion.then(() => 'deleted', (error) => error);

    // Give the deletion time to block on the row lock before committing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await client.query('COMMIT');

    const error = await outcome;
    assert.equal(error.code, 'ACCOUNT_REFERENCED');
    assert.equal(error.referencedBy, 'sesusers');
  } finally {
    client.release();
  }

  assert.equal(await userExists(user.id), true);
});

test('#875: of two concurrent deletions, one deletes and the other finds no account', {
  skip: SKIP_REASON
}, async () => {
  const user = await insertUser(NEVER_ACTIVATED);

  const outcomes = await Promise.allSettled([
    service().deleteNeverActivatedAccount({ adminUserId: ADMIN_USER_ID, userId: user.id, expectedEmail: user.mail }),
    service().deleteNeverActivatedAccount({ adminUserId: ADMIN_USER_ID, userId: user.id, expectedEmail: user.mail })
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const [refusal] = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(refusal.reason.code, 'USER_NOT_FOUND');
  assert.equal(await userExists(user.id), false);
  assert.deepEqual((await auditEventsFor(user.id)).map((event) => event.outcome), ['succeeded']);
});
