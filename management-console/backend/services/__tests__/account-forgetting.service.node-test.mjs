import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCOUNT_FORGETTING_ERRORS,
  FORGETTING_PROCESS_NAME,
  createAccountForgettingService
} from '../account-forgetting.service.js';

const STORED_EMAIL = 'Pat@Example.com';

const STUDENT = Object.freeze({
  id: 22,
  mail: STORED_EMAIL,
  role: 'A',
  anonymized_at: null
});

const silentLogger = { error() {}, info() {} };

function summarize(text) {
  const sql = text.replace(/\s+/g, ' ').trim();
  const steps = [
    [/^(BEGIN|COMMIT|ROLLBACK)$/, sql],
    [/^SELECT id, mail, role, anonymized_at FROM users/, 'SELECT target FOR UPDATE'],
    [/^INSERT INTO student_anonymization_runs/, 'INSERT run'],
    [/^INSERT INTO student_anonymization_events/, 'INSERT event'],
    [/^SELECT id, mail FROM users WHERE id = \$1 AND role = \$2/, 'SELECT student FOR UPDATE'],
    [/^UPDATE differential_selection/, 'UPDATE differential_selection'],
    [/^UPDATE differential_chat/, 'UPDATE differential_chat'],
    [/^UPDATE chat/, 'UPDATE chat'],
    [/^UPDATE actor_selection/, 'UPDATE actor_selection'],
    [/^SELECT id, raw_payload/, 'SELECT external results'],
    [/^SELECT id, outbound_payload/, 'SELECT external jobs'],
    [/^UPDATE sesusers/, 'UPDATE sesusers'],
    [/^DELETE FROM pass_reset/, 'DELETE pass_reset'],
    [/^UPDATE users SET name/, 'UPDATE users'],
    [/^INSERT INTO user_erasure_requests/, 'INSERT erasure requests'],
    [/^UPDATE student_anonymization_events SET status = 'succeeded'/, 'UPDATE event succeeded'],
    [/^UPDATE student_anonymization_runs/, 'UPDATE run'],
    [/^INSERT INTO admin_audit_events/, 'INSERT audit']
  ];
  const match = steps.find(([pattern]) => pattern.test(sql));
  return match ? match[1] : sql;
}

function createFakePool({ user = STUDENT, failOn = null } = {}) {
  const clientCalls = [];
  const poolCalls = [];
  let released = 0;

  function answer(text, params, calls) {
    const step = summarize(text);
    calls.push({ step, params });

    if (step === failOn) {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }
    if (step === 'SELECT target FOR UPDATE') {
      return user ? { rowCount: 1, rows: [user] } : { rowCount: 0, rows: [] };
    }
    if (step === 'SELECT student FOR UPDATE') {
      return { rowCount: 1, rows: [{ id: user.id, mail: user.mail }] };
    }
    if (step === 'INSERT run') {
      return { rowCount: 1, rows: [{ id: '91' }] };
    }
    if (step === 'SELECT external results' || step === 'SELECT external jobs') {
      return { rowCount: 0, rows: [] };
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

function steps(calls) {
  return calls.map((call) => call.step);
}

function auditParams(calls) {
  return calls.filter((call) => call.step === 'INSERT audit').map((call) => call.params);
}

describe('forgetStudent', () => {
  it('anonymizes the student, records the run, the erasure requests and the audit row in one transaction', async () => {
    const pool = createFakePool();
    const service = createAccountForgettingService({ pool, env: {}, logger: silentLogger });

    const result = await service.forgetStudent({ adminUserId: 7, userId: '22', expectedEmail: ' pat@example.COM ' });

    assert.deepEqual(result, {
      id: 22,
      status: 'anonymized',
      runId: 91,
      erasureRequests: [
        { serviceId: 'argumentation-tutor', status: 'pending', attempts: 0 },
        { serviceId: 'polyadic-agent', status: 'pending', attempts: 0 }
      ]
    });
    assert.deepEqual(steps(pool.clientCalls), [
      'BEGIN',
      'SELECT target FOR UPDATE',
      'INSERT run',
      'INSERT event',
      'SELECT student FOR UPDATE',
      'UPDATE differential_selection',
      'UPDATE differential_chat',
      'UPDATE chat',
      'UPDATE actor_selection',
      'SELECT external results',
      'SELECT external jobs',
      'UPDATE sesusers',
      'DELETE pass_reset',
      'UPDATE users',
      'INSERT erasure requests',
      'UPDATE event succeeded',
      'UPDATE run',
      'INSERT audit',
      'COMMIT'
    ]);

    const run = pool.clientCalls.find((call) => call.step === 'INSERT run');
    assert.deepEqual(run.params, [false, '******', 'A', 1, 'admin-user:7', FORGETTING_PROCESS_NAME]);
    const finalized = pool.clientCalls.find((call) => call.step === 'UPDATE run');
    assert.deepEqual(finalized.params, ['completed', 1, 0, 91]);
    assert.deepEqual(auditParams(pool.clientCalls), [[7, 'account.forget', 22, 'succeeded', null]]);
    assert.equal(pool.released, 1);
    assert.deepEqual(pool.poolCalls, []);
  });

  it('uses the placeholder configured for the scheduled job', async () => {
    const pool = createFakePool();
    const service = createAccountForgettingService({
      pool,
      env: { STUDENT_ANONYMIZATION_PLACEHOLDER_TEXT: '[erased]' },
      logger: silentLogger
    });

    await service.forgetStudent({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL });

    const chat = pool.clientCalls.find((call) => call.step === 'UPDATE chat');
    assert.deepEqual(chat.params, ['[erased]', 22]);
  });

  for (const [label, user, expectedEmail, code] of [
    ['an anonymized account', { ...STUDENT, anonymized_at: '2026-01-01T00:00:00Z' }, STORED_EMAIL,
      ACCOUNT_FORGETTING_ERRORS.accountAnonymized],
    ['a teacher', { ...STUDENT, role: 'P' }, STORED_EMAIL, ACCOUNT_FORGETTING_ERRORS.notAStudent],
    ['an administrator', { ...STUDENT, role: 'S' }, STORED_EMAIL, ACCOUNT_FORGETTING_ERRORS.notAStudent],
    ['an account whose email changed', STUDENT, 'other@example.com', ACCOUNT_FORGETTING_ERRORS.accountChanged],
    ['a request without the expected email', STUDENT, null, ACCOUNT_FORGETTING_ERRORS.accountChanged]
  ]) {
    it(`refuses ${label}, changes nothing and records the refusal`, async () => {
      const pool = createFakePool({ user });
      const service = createAccountForgettingService({ pool, env: {}, logger: silentLogger });

      await assert.rejects(
        service.forgetStudent({ adminUserId: 7, userId: 22, expectedEmail }),
        { code }
      );

      assert.deepEqual(steps(pool.clientCalls), ['BEGIN', 'SELECT target FOR UPDATE', 'INSERT audit', 'COMMIT']);
      assert.deepEqual(auditParams(pool.clientCalls), [[7, 'account.forget', 22, 'refused', code]]);
    });
  }

  it('reports a missing account without recording anything', async () => {
    const pool = createFakePool({ user: null });
    const service = createAccountForgettingService({ pool, env: {}, logger: silentLogger });

    await assert.rejects(
      service.forgetStudent({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
      { code: ACCOUNT_FORGETTING_ERRORS.userNotFound }
    );

    assert.deepEqual(steps(pool.clientCalls), ['BEGIN', 'SELECT target FOR UPDATE', 'ROLLBACK']);
    assert.deepEqual(pool.poolCalls, []);
  });

  it('rejects an invalid id before touching the database', async () => {
    const pool = createFakePool();
    const service = createAccountForgettingService({ pool, env: {}, logger: silentLogger });

    await assert.rejects(
      service.forgetStudent({ adminUserId: 7, userId: 'abc', expectedEmail: STORED_EMAIL }),
      { code: ACCOUNT_FORGETTING_ERRORS.invalidUserId }
    );
    assert.deepEqual(pool.clientCalls, []);
  });

  it('rolls everything back on a failure and records it apart, best effort', async () => {
    const pool = createFakePool({ failOn: 'INSERT erasure requests' });
    const service = createAccountForgettingService({ pool, env: {}, logger: silentLogger });

    await assert.rejects(
      service.forgetStudent({ adminUserId: 7, userId: 22, expectedEmail: STORED_EMAIL }),
      { code: '40P01' }
    );

    assert.equal(steps(pool.clientCalls).at(-1), 'ROLLBACK');
    assert.equal(steps(pool.clientCalls).includes('COMMIT'), false);
    assert.deepEqual(auditParams(pool.poolCalls), [[7, 'account.forget', 22, 'failed', 'UNEXPECTED_ERROR']]);
    assert.equal(pool.released, 1);
  });
});
