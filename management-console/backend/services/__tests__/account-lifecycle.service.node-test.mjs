import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCOUNT_LIFECYCLE_ERRORS,
  createAccountLifecycleService
} from '../account-lifecycle.service.js';

const STORED_EMAIL = 'Pat@Example.com';

const PENDING_USER = Object.freeze({
  id: 22,
  mail: STORED_EMAIL,
  active: false,
  email_confirmed: false,
  anonymized_at: null
});

function summarize(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith('SELECT id, mail, active')) {
    return 'SELECT user FOR UPDATE';
  }
  if (normalized.startsWith('UPDATE users')) {
    return 'UPDATE users';
  }
  if (normalized.startsWith('DELETE FROM pass_reset')) {
    return 'DELETE pass_reset';
  }
  if (normalized.startsWith('INSERT INTO admin_audit_events')) {
    return 'INSERT audit';
  }
  return normalized;
}

// A pool whose dedicated client answers the account lookup with `user`
// (null for a missing account) and fails the statement named by `failOn`.
// Statements sent to the pool itself are recorded apart.
function createFakePool({ user = PENDING_USER, failOn = null } = {}) {
  const clientCalls = [];
  const poolCalls = [];
  let released = 0;

  function answer(text, params, calls) {
    const step = summarize(text);
    calls.push({ step, params });
    Object.defineProperty(calls.at(-1), 'sql', { value: text.replace(/\s+/g, ' ').trim() });

    if (step === failOn) {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }
    if (step === 'SELECT user FOR UPDATE') {
      return user ? { rowCount: 1, rows: [user] } : { rowCount: 0, rows: [] };
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

describe('account lifecycle service: confirm a pending account', () => {
  it('activates and confirms the account, deletes its confirmation tokens and records the action in one transaction', async () => {
    const pool = createFakePool();
    const service = createAccountLifecycleService({ pool, logger: silentLogger });

    const result = await service.confirmPendingAccount({ adminUserId: 7, userId: '22', expectedEmail: ' pat@example.COM ' });

    assert.deepEqual(result, { id: 22, status: 'active' });
    assert.deepEqual(pool.clientCalls.map((call) => call.step), [
      'BEGIN',
      'SELECT user FOR UPDATE',
      'UPDATE users',
      'DELETE pass_reset',
      'INSERT audit',
      'COMMIT'
    ]);
    assert.deepEqual(pool.clientCalls[1].params, [22]);
    assert.deepEqual(pool.clientCalls[2].params, [22]);
    assert.deepEqual(pool.clientCalls[3].params, ['Pat@Example.com']);
    assert.deepEqual(pool.clientCalls[4].params, [7, 'account.confirm', 22, 'succeeded', null, null]);
    assert.equal(pool.poolCalls.length, 0);
    assert.equal(pool.released, 1);
  });

  it('only deletes account_confirmation tokens and sets both flags', async () => {
    const pool = createFakePool();
    const service = createAccountLifecycleService({ pool, logger: silentLogger });

    await service.confirmPendingAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL });

    const [update, deletion] = [pool.clientCalls[2], pool.clientCalls[3]];
    assert.match(update.sql, /SET active = true, email_confirmed = true WHERE id = \$1$/);
    assert.match(deletion.sql, /WHERE lower\(mail\) = lower\(\$1\) AND token_purpose = 'account_confirmation'$/);
  });

  for (const [label, user, status] of [
    ['an active account', { ...PENDING_USER, active: true, email_confirmed: true }, 'active'],
    ['an account deactivated by an administrator', { ...PENDING_USER, email_confirmed: true }, 'inactive'],
    ['an anonymized account', { ...PENDING_USER, anonymized_at: '2026-07-01T03:00:00Z' }, 'anonymized']
  ]) {
    it(`refuses ${label}, records the refusal and changes nothing`, async () => {
      const pool = createFakePool({ user });
      const service = createAccountLifecycleService({ pool, logger: silentLogger });

      await assert.rejects(
        service.confirmPendingAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
        (error) => {
          assert.equal(error.code, ACCOUNT_LIFECYCLE_ERRORS.accountNotPending);
          assert.equal(error.accountStatus, status);
          return true;
        }
      );

      assert.deepEqual(pool.clientCalls.map((call) => call.step), [
        'BEGIN',
        'SELECT user FOR UPDATE',
        'INSERT audit',
        'COMMIT'
      ]);
      assert.deepEqual(pool.clientCalls[2].params, [7, 'account.confirm', 22, 'refused', 'ACCOUNT_NOT_PENDING', null]);
      assert.equal(pool.released, 1);
    });
  }

  for (const [label, expectedEmail] of [
    ['another email than the stored one', 'edited-but-unsaved@example.test'],
    ['no expected email', undefined],
    ['a blank expected email', '   ']
  ]) {
    it(`refuses ACCOUNT_CHANGED for ${label}, records the refusal and changes nothing`, async () => {
      const pool = createFakePool();
      const service = createAccountLifecycleService({ pool, logger: silentLogger });

      await assert.rejects(
        service.confirmPendingAccount({ adminUserId: 7, userId: 22, expectedEmail }),
        (error) => {
          assert.equal(error.code, ACCOUNT_LIFECYCLE_ERRORS.accountChanged);
          assert.equal(error.accountStatus, undefined);
          return true;
        }
      );

      assert.deepEqual(pool.clientCalls.map((call) => call.step), [
        'BEGIN',
        'SELECT user FOR UPDATE',
        'INSERT audit',
        'COMMIT'
      ]);
      assert.deepEqual(pool.clientCalls[2].params, [7, 'account.confirm', 22, 'refused', 'ACCOUNT_CHANGED', null]);
      assert.equal(pool.poolCalls.length, 0);
    });
  }

  it('answers USER_NOT_FOUND for a missing account without recording it', async () => {
    const pool = createFakePool({ user: null });
    const service = createAccountLifecycleService({ pool, logger: silentLogger });

    await assert.rejects(
      service.confirmPendingAccount({ adminUserId: 7, userId: 404 }),
      { code: ACCOUNT_LIFECYCLE_ERRORS.userNotFound }
    );

    assert.deepEqual(pool.clientCalls.map((call) => call.step), [
      'BEGIN',
      'SELECT user FOR UPDATE',
      'ROLLBACK'
    ]);
    assert.equal(pool.poolCalls.length, 0);
    assert.equal(pool.released, 1);
  });

  it('answers INVALID_USER_ID without touching the database', async () => {
    const pool = createFakePool();
    const service = createAccountLifecycleService({ pool, logger: silentLogger });

    for (const userId of ['abc', '0', '-4', '1.5', undefined]) {
      await assert.rejects(
        service.confirmPendingAccount({ adminUserId: 7, userId }),
        { code: ACCOUNT_LIFECYCLE_ERRORS.invalidUserId }
      );
    }

    assert.equal(pool.clientCalls.length, 0);
    assert.equal(pool.poolCalls.length, 0);
  });

  it('rolls back an unexpected failure and records it as failed outside the transaction', async () => {
    const pool = createFakePool({ failOn: 'DELETE pass_reset' });
    const service = createAccountLifecycleService({ pool, logger: silentLogger });

    await assert.rejects(
      service.confirmPendingAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
      { message: 'deadlock detected' }
    );

    assert.deepEqual(pool.clientCalls.map((call) => call.step), [
      'BEGIN',
      'SELECT user FOR UPDATE',
      'UPDATE users',
      'DELETE pass_reset',
      'ROLLBACK'
    ]);
    assert.deepEqual(pool.poolCalls, [
      { step: 'INSERT audit', params: [7, 'account.confirm', 22, 'failed', 'UNEXPECTED_ERROR', null] }
    ]);
    assert.equal(pool.released, 1);
  });

  it('reports the original error when the failure cannot be recorded either', async () => {
    const pool = createFakePool({ failOn: 'INSERT audit' });
    const logged = [];
    const service = createAccountLifecycleService({
      pool,
      logger: { error: (...args) => logged.push(args) }
    });

    await assert.rejects(
      service.confirmPendingAccount({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
      { message: 'deadlock detected' }
    );

    assert.equal(pool.clientCalls.at(-1).step, 'ROLLBACK');
    assert.equal(pool.poolCalls.length, 1);
    assert.equal(logged.length, 1);
  });
});
