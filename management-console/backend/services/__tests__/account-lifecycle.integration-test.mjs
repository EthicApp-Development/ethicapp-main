// Integration tests for the confirmation of a pending account and the admin
// audit log (V27, #874), against a real PostgreSQL database with migrations
// V1-V27 applied.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts and audit events,
// which are append-only and are never removed.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { createAccountLifecycleService } from '../account-lifecycle.service.js';
import { ADMIN_AUDIT_ACTIONS, recordAdminAuditEvent } from '../admin-audit.service.js';

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
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  return pool;
}

async function query(sql, params = []) {
  return (await getPool().query(sql, params)).rows;
}

test.after(async () => {
  await pool?.end();
});

async function insertUser({ active, emailConfirmed, anonymized = false }) {
  const mail = `it-874-${randomUUID()}@example.com`;
  const [row] = await query(
    `
      INSERT INTO users (name, rut, mail, role, active, email_confirmed, anonymized_at)
      VALUES ('Integration Student', $1, $2, 'A', $3, $4, CASE WHEN $5 THEN NOW() END)
      RETURNING id, mail
    `,
    [randomUUID(), mail, active, emailConfirmed, anonymized]
  );
  return { id: row.id, mail: row.mail };
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

async function auditEventsFor(userId) {
  return query(
    `
      SELECT admin_user_id, action, target_user_id, outcome, reason_code
      FROM admin_audit_events
      WHERE target_user_id = $1
      ORDER BY id
    `,
    [userId]
  );
}

function service() {
  return createAccountLifecycleService({ pool: getPool(), logger: silentLogger });
}

test('V27: a pending account is confirmed, loses its confirmation tokens and the action is recorded', {
  skip: SKIP_REASON
}, async () => {
  const user = await insertUser({ active: false, emailConfirmed: false });
  await insertToken(user.mail.toUpperCase(), 'account_confirmation');
  await insertToken(user.mail, 'account_confirmation');
  await insertToken(user.mail, 'password_reset');

  const result = await service().confirmPendingAccount({ adminUserId: ADMIN_USER_ID, userId: user.id });

  assert.deepEqual(result, { id: user.id, status: 'active' });
  const [row] = await query('SELECT active, email_confirmed FROM users WHERE id = $1', [user.id]);
  assert.deepEqual(row, { active: true, email_confirmed: true });

  const tokens = await query(
    'SELECT token_purpose FROM pass_reset WHERE lower(mail) = lower($1) ORDER BY id',
    [user.mail]
  );
  assert.deepEqual(tokens, [{ token_purpose: 'password_reset' }]);

  assert.deepEqual(await auditEventsFor(user.id), [{
    admin_user_id: ADMIN_USER_ID,
    action: 'account.confirm',
    target_user_id: user.id,
    outcome: 'succeeded',
    reason_code: null
  }]);
});

test('V27: active, deactivated and anonymized accounts are refused, unchanged, and the refusal is recorded', {
  skip: SKIP_REASON
}, async () => {
  for (const [state, expectedStatus] of [
    [{ active: true, emailConfirmed: true }, 'active'],
    [{ active: false, emailConfirmed: true }, 'inactive'],
    [{ active: false, emailConfirmed: false, anonymized: true }, 'anonymized']
  ]) {
    const user = await insertUser(state);
    await insertToken(user.mail, 'account_confirmation');

    await assert.rejects(
      service().confirmPendingAccount({ adminUserId: ADMIN_USER_ID, userId: user.id }),
      { code: 'ACCOUNT_NOT_PENDING', accountStatus: expectedStatus }
    );

    const [row] = await query('SELECT active, email_confirmed FROM users WHERE id = $1', [user.id]);
    assert.deepEqual(row, { active: state.active, email_confirmed: state.emailConfirmed });
    const tokens = await query('SELECT id FROM pass_reset WHERE mail = $1', [user.mail]);
    assert.equal(tokens.length, 1);
    assert.deepEqual(await auditEventsFor(user.id), [{
      admin_user_id: ADMIN_USER_ID,
      action: 'account.confirm',
      target_user_id: user.id,
      outcome: 'refused',
      reason_code: 'ACCOUNT_NOT_PENDING'
    }]);
  }
});

test('V27: of two concurrent confirmations, one succeeds and the other is refused', {
  skip: SKIP_REASON
}, async () => {
  const user = await insertUser({ active: false, emailConfirmed: false });

  const outcomes = await Promise.allSettled([
    service().confirmPendingAccount({ adminUserId: ADMIN_USER_ID, userId: user.id }),
    service().confirmPendingAccount({ adminUserId: ADMIN_USER_ID, userId: user.id })
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const [refusal] = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(refusal.reason.code, 'ACCOUNT_NOT_PENDING');
  assert.equal(refusal.reason.accountStatus, 'active');

  const events = await auditEventsFor(user.id);
  assert.deepEqual(events.map((event) => event.outcome).sort(), ['refused', 'succeeded']);
});

test('V27: admin_audit_events is append-only', { skip: SKIP_REASON }, async () => {
  const user = await insertUser({ active: true, emailConfirmed: true });
  const { id } = await recordAdminAuditEvent(getPool(), {
    adminUserId: ADMIN_USER_ID,
    action: ADMIN_AUDIT_ACTIONS.accountConfirm,
    targetUserId: user.id,
    outcome: 'succeeded'
  });

  for (const sql of [
    `UPDATE admin_audit_events SET outcome = 'failed' WHERE id = ${id}`,
    `DELETE FROM admin_audit_events WHERE id = ${id}`,
    'TRUNCATE admin_audit_events'
  ]) {
    await assert.rejects(query(sql), (error) => {
      assert.equal(error.code, '23001', sql);
      assert.match(error.message, /append-only/);
      return true;
    });
  }
});

test('V27: the checks keep free text and unknown outcomes out of the audit log', {
  skip: SKIP_REASON
}, async () => {
  const cases = [
    [['account.confirm', 'done', null], 'admin_audit_events_outcome_check'],
    [['account.confirm', 'refused', 'pat@example.com'], 'admin_audit_events_reason_code_check'],
    [['account.confirm', 'refused', 'Account not pending'], 'admin_audit_events_reason_code_check'],
    [['Confirm account of Pat', 'succeeded', null], 'admin_audit_events_action_check'],
    [['confirm', 'succeeded', null], 'admin_audit_events_action_check']
  ];

  for (const [[action, outcome, reasonCode], constraint] of cases) {
    await assert.rejects(
      query(
        `
          INSERT INTO admin_audit_events (admin_user_id, action, target_user_id, outcome, reason_code)
          VALUES ($1, $2, NULL, $3, $4)
        `,
        [ADMIN_USER_ID, action, outcome, reasonCode]
      ),
      (error) => {
        assert.equal(error.constraint, constraint, `${action} ${outcome} ${reasonCode}`);
        return true;
      }
    );
  }

  await assert.rejects(
    query(
      `
        INSERT INTO admin_audit_events (admin_user_id, action, target_user_id, outcome)
        VALUES (0, 'account.confirm', NULL, 'succeeded')
      `
    ),
    { constraint: 'admin_audit_events_user_ids_check' }
  );
});
