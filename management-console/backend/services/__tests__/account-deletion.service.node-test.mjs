import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCOUNT_DELETION_ERRORS,
  createAccountDeletionService,
  isNeverActivatedAccount
} from '../account-deletion.service.js';
import { BLOCKING_USER_REFERENCES } from '../user-references.js';

const STORED_EMAIL = 'Pat@Example.com';

const NEVER_ACTIVATED_USER = Object.freeze({
  id: 22,
  mail: STORED_EMAIL,
  active: false,
  email_confirmed: false,
  anonymized_at: null,
  last_login_at: null
});

function summarize(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith('SELECT id, mail, active')) {
    return 'SELECT user FOR UPDATE';
  }
  if (normalized.startsWith('SELECT 0 AS position')) {
    return 'SELECT references';
  }
  if (normalized.startsWith('DELETE FROM pass_reset')) {
    return 'DELETE pass_reset';
  }
  if (normalized.startsWith('DELETE FROM users')) {
    return 'DELETE users';
  }
  if (normalized.startsWith('INSERT INTO admin_audit_events')) {
    return 'INSERT audit';
  }
  return normalized;
}

// A pool whose dedicated client answers the account lookup with `user`
// (null for a missing account), the reference check with the positions in
// `referencePositions`, and fails the statement named by `failOn`.
// Statements sent to the pool itself are recorded apart.
function createFakePool({ user = NEVER_ACTIVATED_USER, referencePositions = [], failOn = null } = {}) {
  const clientCalls = [];
  const poolCalls = [];
  let released = 0;

  function answer(text, params, calls) {
    const step = summarize(text);
    calls.push({ step, params, sql: text.replace(/\s+/g, ' ').trim() });

    if (step === failOn) {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }
    if (step === 'SELECT user FOR UPDATE') {
      return user ? { rowCount: 1, rows: [user] } : { rowCount: 0, rows: [] };
    }
    if (step === 'SELECT references') {
      return {
        rowCount: referencePositions.length,
        rows: referencePositions.map((position) => ({ position }))
      };
    }
    if (step === 'INSERT audit') {
      return { rows: [{ id: '1', occurred_at: '2026-10-29T12:00:00.000Z' }] };
    }
    return { rowCount: 1, rows: [] };
  }

  return {
    clientCalls,
    poolCalls,
    get released() {
      return released;
    },
    async connect() {
      return {
        query: async (text, params) => answer(text, params, clientCalls),
        release: () => {
          released += 1;
        }
      };
    },
    async query(text, params) {
      return answer(text, params, poolCalls);
    }
  };
}

const silentLogger = { error: () => {} };

function steps(pool) {
  return pool.clientCalls.map((call) => call.step);
}

describe('isNeverActivatedAccount', () => {
  it('accepts only an inactive, unconfirmed, never signed-in and not anonymized account', () => {
    const neverActivated = { active: false, emailConfirmed: false, anonymizedAt: null, lastLoginAt: null };

    assert.equal(isNeverActivatedAccount(neverActivated), true);
    assert.equal(isNeverActivatedAccount({ ...neverActivated, active: true }), false);
    assert.equal(isNeverActivatedAccount({ ...neverActivated, active: null }), false);
    assert.equal(isNeverActivatedAccount({ ...neverActivated, emailConfirmed: true }), false);
    assert.equal(isNeverActivatedAccount({ ...neverActivated, emailConfirmed: null }), false);
    assert.equal(isNeverActivatedAccount({ ...neverActivated, anonymizedAt: '2026-07-01T03:00:00Z' }), false);
    assert.equal(isNeverActivatedAccount({ ...neverActivated, lastLoginAt: '2026-10-01T10:00:00' }), false);
  });
});

describe('account deletion service: delete a never-activated account', () => {
  it('checks the references, deletes the tokens and the account and records the action in one transaction', async () => {
    const pool = createFakePool();
    const service = createAccountDeletionService({ pool, logger: silentLogger });

    const result = await service.deleteNeverActivatedAccount({
      adminUserId: 7,
      userId: '22',
      expectedEmail: ' pat@example.COM '
    });

    assert.deepEqual(result, { id: 22, deleted: true });
    assert.deepEqual(steps(pool), [
      'BEGIN',
      'SELECT user FOR UPDATE',
      'SELECT references',
      'DELETE pass_reset',
      'DELETE users',
      'INSERT audit',
      'COMMIT'
    ]);
    assert.deepEqual(pool.clientCalls[1].params, [22]);
    assert.match(pool.clientCalls[1].sql, /last_login_at FROM users WHERE id = \$1 FOR UPDATE$/);
    assert.deepEqual(pool.clientCalls[2].params, [22]);
    // Every token of the email goes, whatever its purpose.
    assert.match(pool.clientCalls[3].sql, /WHERE lower\(mail\) = lower\(\$1\)$/);
    assert.deepEqual(pool.clientCalls[3].params, [STORED_EMAIL]);
    assert.deepEqual(pool.clientCalls[4].params, [22]);
    // The audit row names the administrator and the former id, nothing else.
    assert.deepEqual(pool.clientCalls[5].params, [7, 'account.delete', 22, 'succeeded', null]);
    assert.equal(pool.poolCalls.length, 0);
    assert.equal(pool.released, 1);
  });

  it('checks every blocking reference in one query', async () => {
    const pool = createFakePool();
    const service = createAccountDeletionService({ pool, logger: silentLogger });

    await service.deleteNeverActivatedAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL });

    const { sql } = pool.clientCalls[2];
    for (const entry of BLOCKING_USER_REFERENCES) {
      assert.ok(
        sql.includes(`FROM ${entry.table} WHERE ${entry.column} = $1`),
        `${entry.table}.${entry.column} is checked`
      );
    }
  });

  for (const [label, user, status] of [
    ['an active account', { ...NEVER_ACTIVATED_USER, active: true, email_confirmed: true }, 'active'],
    ['an account deactivated by an administrator', { ...NEVER_ACTIVATED_USER, email_confirmed: true }, 'inactive'],
    ['an anonymized account', { ...NEVER_ACTIVATED_USER, anonymized_at: '2026-07-01T03:00:00Z' }, 'anonymized'],
    ['a pending account whose owner signed in once', { ...NEVER_ACTIVATED_USER, last_login_at: '2026-10-01T10:00:00' }, 'pending']
  ]) {
    it(`refuses ${label}, records the refusal and deletes nothing`, async () => {
      const pool = createFakePool({ user });
      const service = createAccountDeletionService({ pool, logger: silentLogger });

      await assert.rejects(
        service.deleteNeverActivatedAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
        (error) => {
          assert.equal(error.code, ACCOUNT_DELETION_ERRORS.accountNotDeletable);
          assert.equal(error.accountStatus, status);
          return true;
        }
      );

      assert.deepEqual(steps(pool), ['BEGIN', 'SELECT user FOR UPDATE', 'INSERT audit', 'COMMIT']);
      assert.deepEqual(pool.clientCalls[2].params, [7, 'account.delete', 22, 'refused', 'ACCOUNT_NOT_DELETABLE']);
      assert.equal(pool.released, 1);
    });
  }

  for (const [label, expectedEmail] of [
    ['another email than the stored one', 'edited-but-unsaved@example.test'],
    ['no expected email', undefined],
    ['a blank expected email', '   ']
  ]) {
    it(`refuses ACCOUNT_CHANGED for ${label}, records the refusal and deletes nothing`, async () => {
      const pool = createFakePool();
      const service = createAccountDeletionService({ pool, logger: silentLogger });

      await assert.rejects(
        service.deleteNeverActivatedAccount({ adminUserId: 7, userId: 22, expectedEmail }),
        (error) => {
          assert.equal(error.code, ACCOUNT_DELETION_ERRORS.accountChanged);
          assert.equal(error.accountStatus, undefined);
          return true;
        }
      );

      assert.deepEqual(steps(pool), ['BEGIN', 'SELECT user FOR UPDATE', 'INSERT audit', 'COMMIT']);
      assert.deepEqual(pool.clientCalls[2].params, [7, 'account.delete', 22, 'refused', 'ACCOUNT_CHANGED']);
    });
  }

  it('refuses an account that a blocking table references, naming the first one', async () => {
    const sesusersPosition = BLOCKING_USER_REFERENCES.findIndex((entry) => entry.table === 'sesusers');
    const chatPosition = BLOCKING_USER_REFERENCES.findIndex((entry) => entry.table === 'chat');
    const pool = createFakePool({ referencePositions: [sesusersPosition, chatPosition] });
    const service = createAccountDeletionService({ pool, logger: silentLogger });

    await assert.rejects(
      service.deleteNeverActivatedAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
      (error) => {
        assert.equal(error.code, ACCOUNT_DELETION_ERRORS.accountReferenced);
        assert.equal(error.referencedBy, 'sesusers');
        assert.equal(error.referenceCategory, 'activities');
        return true;
      }
    );

    assert.deepEqual(steps(pool), [
      'BEGIN',
      'SELECT user FOR UPDATE',
      'SELECT references',
      'INSERT audit',
      'COMMIT'
    ]);
    assert.deepEqual(pool.clientCalls[3].params, [7, 'account.delete', 22, 'refused', 'REFERENCED_BY_SESUSERS']);
  });

  it('answers USER_NOT_FOUND for a missing account without recording it', async () => {
    const pool = createFakePool({ user: null });
    const service = createAccountDeletionService({ pool, logger: silentLogger });

    await assert.rejects(
      service.deleteNeverActivatedAccount({ adminUserId: 7, userId: 404, expectedEmail: STORED_EMAIL }),
      { code: ACCOUNT_DELETION_ERRORS.userNotFound }
    );

    assert.deepEqual(steps(pool), ['BEGIN', 'SELECT user FOR UPDATE', 'ROLLBACK']);
    assert.equal(pool.poolCalls.length, 0);
    assert.equal(pool.released, 1);
  });

  it('answers INVALID_USER_ID without touching the database', async () => {
    const pool = createFakePool();
    const service = createAccountDeletionService({ pool, logger: silentLogger });

    for (const userId of ['abc', 0, -3, 2.5, null]) {
      await assert.rejects(
        service.deleteNeverActivatedAccount({ adminUserId: 7, userId, expectedEmail: STORED_EMAIL }),
        { code: ACCOUNT_DELETION_ERRORS.invalidUserId }
      );
    }

    assert.equal(pool.clientCalls.length, 0);
    assert.equal(pool.poolCalls.length, 0);
  });

  it('rolls back an unexpected failure and records it as failed outside the transaction', async () => {
    const pool = createFakePool({ failOn: 'DELETE users' });
    const service = createAccountDeletionService({ pool, logger: silentLogger });

    await assert.rejects(
      service.deleteNeverActivatedAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
      { message: 'deadlock detected' }
    );

    assert.deepEqual(steps(pool), [
      'BEGIN',
      'SELECT user FOR UPDATE',
      'SELECT references',
      'DELETE pass_reset',
      'DELETE users',
      'ROLLBACK'
    ]);
    assert.deepEqual(pool.poolCalls.map((call) => call.step), ['INSERT audit']);
    assert.deepEqual(pool.poolCalls[0].params, [7, 'account.delete', 22, 'failed', 'UNEXPECTED_ERROR']);
    assert.equal(pool.released, 1);
  });
});
