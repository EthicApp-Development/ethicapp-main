import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAdminAuditEventParams } from '../admin-audit.service.js';
import {
  BLOCKING_USER_REFERENCES,
  FORGETTING_TREATMENTS,
  USER_REFERENCE_CATEGORIES,
  USER_REFERENCE_RULES,
  USER_REFERENCES,
  buildBlockingReferencesQuery,
  userReferenceReasonCode
} from '../user-references.js';

describe('user references', () => {
  it('lists each column once', () => {
    const keys = USER_REFERENCES.map((entry) => `${entry.table}.${entry.column}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('blocks the deletion on every column the database would refuse or that has no foreign key, except the audit log', () => {
    for (const entry of USER_REFERENCES) {
      const key = `${entry.table}.${entry.column}`;
      const refusedByDatabase = entry.onDelete === USER_REFERENCE_RULES.noAction ||
        entry.onDelete === USER_REFERENCE_RULES.restrict;

      if (refusedByDatabase) {
        assert.equal(entry.blocksDeletion, true, key);
      }
      if (entry.onDelete === null && entry.table !== 'admin_audit_events') {
        assert.equal(entry.blocksDeletion, true, key);
      }
      assert.ok(
        entry.onDelete === null || Object.values(USER_REFERENCE_RULES).includes(entry.onDelete),
        key
      );
      assert.ok(Object.values(USER_REFERENCE_CATEGORIES).includes(entry.category), key);
    }

    assert.deepEqual(
      USER_REFERENCES.filter((entry) => entry.table === 'admin_audit_events').map((entry) => entry.blocksDeletion),
      [false, false]
    );
  });

  it('blocks the deletion on the tables the issue lists, and on authored cases', () => {
    assert.deepEqual(
      BLOCKING_USER_REFERENCES.map((entry) => `${entry.table}.${entry.column}`).sort(),
      [
        'actor_selection.uid',
        'ai_service_policy_versions.created_by',
        'chat.uid',
        'designs.creator',
        'differential.creator',
        'differential_chat.uid',
        'differential_selection.uid',
        'ethical_cases.creator',
        'external_service_jobs.user_id',
        'external_service_results.user_id',
        'jigsaw_users.userid',
        'sessions.creator',
        'sesusers.uid',
        'student_anonymization_events.user_id',
        'teams.leader',
        'teamusers.uid',
        'upload_deletion_requests.user_id',
        'user_erasure_requests.user_id'
      ]
    );
  });

  it('says what forgetting an account does with every column (#877)', () => {
    for (const entry of USER_REFERENCES) {
      assert.ok(
        Object.values(FORGETTING_TREATMENTS).includes(entry.onForget),
        `${entry.table}.${entry.column}`
      );
    }

    const byTreatment = (treatment) => USER_REFERENCES
      .filter((entry) => entry.onForget === treatment)
      .map((entry) => `${entry.table}.${entry.column}`)
      .sort();

    assert.deepEqual(byTreatment(FORGETTING_TREATMENTS.materials), ['designs.creator', 'ethical_cases.creator']);
    assert.deepEqual(byTreatment(FORGETTING_TREATMENTS.transferred), ['differential.creator', 'sessions.creator']);
    assert.deepEqual(byTreatment(FORGETTING_TREATMENTS.textReplaced), [
      'actor_selection.uid',
      'chat.uid',
      'differential_chat.uid',
      'differential_selection.uid'
    ]);
    assert.deepEqual(byTreatment(FORGETTING_TREATMENTS.payloadRedacted), [
      'external_service_jobs.user_id',
      'external_service_results.user_id'
    ]);
    assert.deepEqual(byTreatment(FORGETTING_TREATMENTS.deleted), ['user_passkeys.user_id']);
  });

  it('gives every blocking table a reason code the audit log accepts', () => {
    for (const entry of BLOCKING_USER_REFERENCES) {
      const reasonCode = userReferenceReasonCode(entry);
      assert.match(reasonCode, /^REFERENCED_BY_[A-Z_]+$/);
      assert.doesNotThrow(() => buildAdminAuditEventParams({
        adminUserId: 1,
        action: 'account.delete',
        targetUserId: 2,
        outcome: 'refused',
        reasonCode
      }), reasonCode);
    }
  });

  it('builds one query that reports the referencing tables by position', () => {
    const sql = buildBlockingReferencesQuery([
      { table: 'sessions', column: 'creator' },
      { table: 'chat', column: 'uid' }
    ]);

    assert.equal(
      sql,
      [
        'SELECT 0 AS position WHERE EXISTS (SELECT 1 FROM sessions WHERE creator = $1)',
        'UNION ALL',
        'SELECT 1 AS position WHERE EXISTS (SELECT 1 FROM chat WHERE uid = $1)',
        'ORDER BY position'
      ].join('\n')
    );
  });
});
