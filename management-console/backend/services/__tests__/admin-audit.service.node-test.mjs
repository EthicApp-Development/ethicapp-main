import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_OUTCOMES,
  buildAdminAuditEventParams,
  recordAdminAuditEvent,
  recordAdminAuditEventBestEffort
} from '../admin-audit.service.js';

function createExecutor({ fail = false } = {}) {
  const calls = [];

  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (fail) {
        throw new Error('connection lost');
      }
      return { rows: [{ id: '41', occurred_at: '2026-10-29T12:00:00.000Z' }] };
    }
  };
}

const validEvent = Object.freeze({
  adminUserId: 7,
  action: ADMIN_AUDIT_ACTIONS.accountConfirm,
  targetUserId: 22,
  outcome: ADMIN_AUDIT_OUTCOMES.succeeded
});

describe('admin audit events', () => {
  it('builds the INSERT parameters of a valid event', () => {
    assert.deepEqual(buildAdminAuditEventParams(validEvent), [7, 'account.confirm', 22, 'succeeded', null, null]);
    assert.deepEqual(
      buildAdminAuditEventParams({
        ...validEvent,
        adminUserId: '7',
        targetUserId: '22',
        outcome: ADMIN_AUDIT_OUTCOMES.refused,
        reasonCode: 'ACCOUNT_NOT_PENDING'
      }),
      [7, 'account.confirm', 22, 'refused', 'ACCOUNT_NOT_PENDING', null]
    );
  });

  it('records the role of the target account when given (V32)', () => {
    assert.deepEqual(
      buildAdminAuditEventParams({ ...validEvent, action: ADMIN_AUDIT_ACTIONS.accountForget, targetRole: 'P' }),
      [7, 'account.forget', 22, 'succeeded', null, 'P']
    );
    for (const targetRole of ['A', 'S']) {
      assert.equal(buildAdminAuditEventParams({ ...validEvent, targetRole })[5], targetRole);
    }
  });

  it('accepts an event without a target account', () => {
    assert.deepEqual(
      buildAdminAuditEventParams({ ...validEvent, targetUserId: undefined }),
      [7, 'account.confirm', null, 'succeeded', null, null]
    );
  });

  it('rejects malformed events before anything is written', () => {
    const invalidEvents = [
      { ...validEvent, adminUserId: undefined },
      { ...validEvent, adminUserId: 0 },
      { ...validEvent, targetUserId: -3 },
      { ...validEvent, targetUserId: 'abc' },
      { ...validEvent, action: 'account.rename' },
      { ...validEvent, outcome: 'done' },
      { ...validEvent, reasonCode: 'pat@example.com' },
      { ...validEvent, reasonCode: 'Account not pending' },
      { ...validEvent, reasonCode: 'A'.repeat(65) },
      { ...validEvent, targetRole: 'teacher' },
      { ...validEvent, targetRole: 'X' }
    ];

    for (const event of invalidEvents) {
      assert.throws(() => buildAdminAuditEventParams(event), TypeError, JSON.stringify(event));
    }
  });

  it('inserts the event through the given executor and returns its id', async () => {
    const executor = createExecutor();

    const recorded = await recordAdminAuditEvent(executor, {
      ...validEvent,
      outcome: ADMIN_AUDIT_OUTCOMES.refused,
      reasonCode: 'ACCOUNT_NOT_PENDING'
    });

    assert.deepEqual(recorded, { id: 41, occurredAt: '2026-10-29T12:00:00.000Z' });
    assert.equal(executor.calls.length, 1);
    assert.match(executor.calls[0].text, /INSERT INTO admin_audit_events/);
    assert.match(executor.calls[0].text, /\(admin_user_id, action, target_user_id, outcome, reason_code, target_role\)/);
    assert.deepEqual(executor.calls[0].params, [7, 'account.confirm', 22, 'refused', 'ACCOUNT_NOT_PENDING', null]);
  });

  it('does not query for an invalid event', async () => {
    const executor = createExecutor();

    await assert.rejects(
      recordAdminAuditEvent(executor, { ...validEvent, outcome: 'unknown' }),
      TypeError
    );
    assert.equal(executor.calls.length, 0);
  });

  it('records best effort without throwing when the write fails', async () => {
    const executor = createExecutor({ fail: true });
    const logged = [];
    const logger = { error: (...args) => logged.push(args) };

    const recorded = await recordAdminAuditEventBestEffort(executor, {
      ...validEvent,
      outcome: ADMIN_AUDIT_OUTCOMES.failed,
      reasonCode: 'UNEXPECTED_ERROR'
    }, logger);

    assert.equal(recorded, null);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], {
      action: 'account.confirm',
      outcome: 'failed',
      error: 'connection lost'
    });
  });
});
