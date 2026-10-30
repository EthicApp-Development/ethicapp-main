import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCOUNT_FORGETTING_ERRORS,
  createAccountForgettingService
} from '../account-forgetting.service.js';

// Forgetting a teacher (#877), with a fake database: the order of the
// statements, the refusals before and inside the transaction, and the
// preview. The SQL itself runs against PostgreSQL in
// account-forgetting-teacher.integration-test.mjs.

const STORED_EMAIL = 'Tom@Example.com';
const RECIPIENT_EMAIL = 'rita@example.com';

const TEACHER = Object.freeze({ id: 22, mail: STORED_EMAIL, role: 'P', active: true, anonymized_at: null });
const RECIPIENT = Object.freeze({ id: 40, mail: RECIPIENT_EMAIL, role: 'P', active: true, anonymized_at: null });

const silentLogger = { error() {}, info() {} };

const STEPS = [
  [/^(BEGIN|COMMIT|ROLLBACK)$/, null],
  [/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/, 'BEGIN READ ONLY'],
  [/^SELECT id, mail, role, active, anonymized_at FROM users .* FOR UPDATE$/, 'LOCK accounts'],
  [/^SELECT id, mail, role, active, anonymized_at FROM users/, 'READ accounts'],
  [/^SELECT count\(\*\)::integer AS open_activities/, 'COUNT open activities'],
  [/^INSERT INTO student_anonymization_runs/, 'INSERT run'],
  [/^SELECT DISTINCT lower\(author\.author_email\)/, 'SELECT author emails'],
  [/^SELECT d\.id FROM designs d/, 'SELECT deletable designs'],
  [/^SELECT c\.id, c\.pdf_path/, 'SELECT deletable cases'],
  [/^DELETE FROM designs/, 'DELETE designs'],
  [/^SELECT DISTINCT author_id/, 'SELECT case authors'],
  [/^DELETE FROM ethical_cases /, 'DELETE cases'],
  [/^DELETE FROM ethical_case_author/, 'DELETE orphan authors'],
  [/^UPDATE ethical_cases SET creator/, 'TRANSFER cases'],
  [/^UPDATE designs SET creator/, 'TRANSFER designs'],
  [/^UPDATE sessions SET creator/, 'TRANSFER activities'],
  [/^UPDATE differential SET creator/, 'TRANSFER differential'],
  [/^SELECT \(SELECT count\(\*\)::integer FROM ethical_cases WHERE creator = \$1\) AS cases,.*case_copies_by_others/, 'COUNT totals'],
  [/^SELECT \(SELECT count\(\*\)::integer FROM ethical_cases WHERE creator = \$1\) AS cases, \(SELECT count\(\*\)::integer FROM designs WHERE creator = \$1\) AS designs, \(SELECT count\(\*\)::integer FROM sessions/, 'COUNT remaining'],
  [/^UPDATE ethical_cases SET author_email/, 'ERASE case emails'],
  [/^UPDATE ethical_case_author SET author_email/, 'ERASE author emails'],
  [/^UPDATE designs SET design = design #-/, 'ERASE design emails'],
  [/^UPDATE pdf_render_jobs/, 'RERENDER'],
  [/^INSERT INTO student_anonymization_events/, 'INSERT event'],
  [/^SELECT id, mail, profile_image_path/, 'STEP lock'],
  [/^UPDATE users SET name/, 'UPDATE users'],
  [/^INSERT INTO upload_deletion_requests/, 'INSERT upload deletions'],
  [/^INSERT INTO user_erasure_requests/, 'INSERT erasure requests'],
  [/^UPDATE student_anonymization_runs/, 'UPDATE run'],
  [/^INSERT INTO admin_audit_events/, 'INSERT audit']
];

function summarize(text) {
  const sql = text.replace(/\s+/g, ' ').trim();
  const match = STEPS.find(([pattern]) => pattern.test(sql));
  if (!match) {
    return sql.split(' ').slice(0, 3).join(' ');
  }
  return match[1] ?? sql;
}

function createFakePool({
  accounts = [TEACHER, RECIPIENT],
  openActivities = 0,
  deletableDesigns = [{ id: 7 }],
  deletableCases = [{
    id: 12,
    pdf_path: '/uploads/cases/12/case.pdf',
    source_path: '/uploads/cases/12/case.pdf',
    manifest_path: '/uploads/cases/12/representation.json',
    render_status: 'completed'
  }],
  failOn = null
} = {}) {
  const clientCalls = [];
  const poolCalls = [];
  let released = 0;

  function answer(text, params, calls) {
    const step = summarize(text);
    calls.push({ step, params });

    if (step === failOn) {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }

    switch (step) {
      case 'LOCK accounts':
      case 'READ accounts': {
        const rows = accounts.filter((account) => params[0].includes(account.id));
        return { rowCount: rows.length, rows };
      }
      case 'COUNT open activities':
        return { rows: [{ open_activities: openActivities }] };
      case 'INSERT run':
        return { rows: [{ id: '91' }] };
      case 'SELECT author emails':
        return { rows: [{ email: 'tom.author@example.com' }] };
      case 'SELECT deletable designs':
        return { rows: deletableDesigns };
      case 'SELECT deletable cases':
        return { rows: deletableCases };
      case 'DELETE designs':
        return { rowCount: deletableDesigns.length };
      case 'SELECT case authors':
        return { rows: [{ author_id: 5 }] };
      case 'DELETE cases':
        return { rowCount: deletableCases.length };
      case 'TRANSFER cases':
        return { rowCount: 2 };
      case 'TRANSFER designs':
        return { rowCount: 3 };
      case 'TRANSFER activities':
        return { rowCount: 4 };
      case 'COUNT remaining':
        return { rows: [{ cases: 0, designs: 0, activities: 0 }] };
      case 'COUNT totals':
        return { rows: [{ cases: 5, designs: 4, activities: 3, case_copies_by_others: 2, design_copies_by_others: 1 }] };
      case 'ERASE case emails':
        return { rowCount: 1, rows: [{ id: 30 }] };
      case 'STEP lock':
        return { rowCount: 1, rows: [{ id: TEACHER.id, mail: STORED_EMAIL }] };
      case 'INSERT audit':
        return { rows: [{ id: '1', occurred_at: '2026-10-30T12:00:00.000Z' }] };
      default:
        return { rowCount: 0, rows: [] };
    }
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

function call(calls, step) {
  return calls.find((entry) => entry.step === step);
}

function auditParams(calls) {
  return calls.filter((entry) => entry.step === 'INSERT audit').map((entry) => entry.params);
}

function finishSucceeding(log = []) {
  return async () => {
    log.push('finish');
    return { ok: true, error: null, finished: [3, 4], skipped: [], failed: [] };
  };
}

function service(pool) {
  return createAccountForgettingService({ pool, env: {}, logger: silentLogger });
}

describe('forgetTeacher', () => {
  it('finishes the activities, then anonymizes the teacher and handles the materials in one transaction', async () => {
    const pool = createFakePool();
    const order = [];
    const finishActivities = async () => {
      order.push(`finish after ${pool.clientCalls.length} transaction statements`);
      return { ok: true, error: null, finished: [3, 4], skipped: [], failed: [] };
    };

    const result = await service(pool).forgetTeacher({
      adminUserId: 7,
      userId: '22',
      expectedEmail: ' tom@example.COM ',
      finishActivities
    });

    assert.deepEqual(order, ['finish after 0 transaction statements']);
    assert.deepEqual(steps(pool.poolCalls), ['READ accounts']);
    assert.deepEqual(steps(pool.clientCalls), [
      'BEGIN',
      'LOCK accounts',
      'COUNT open activities',
      'INSERT run',
      'SELECT author emails',
      'SELECT deletable designs',
      'SELECT deletable cases',
      'DELETE designs',
      'SELECT case authors',
      'DELETE cases',
      'DELETE orphan authors',
      'COUNT remaining',
      'ERASE case emails',
      'ERASE author emails',
      'ERASE design emails',
      'RERENDER',
      'INSERT event',
      'STEP lock',
      'UPDATE differential_selection SET',
      'UPDATE differential_chat SET',
      'UPDATE chat SET',
      'UPDATE actor_selection SET',
      'SELECT id, raw_payload,',
      'SELECT id, outbound_payload',
      'UPDATE sesusers SET',
      'DELETE FROM pass_reset',
      'DELETE FROM user_passkeys',
      'UPDATE users',
      'INSERT erasure requests',
      'UPDATE student_anonymization_events SET',
      'INSERT upload deletions',
      'UPDATE run',
      'INSERT audit',
      'COMMIT'
    ]);

    assert.deepEqual(call(pool.clientCalls, 'LOCK accounts').params, [[22]]);
    assert.equal(call(pool.clientCalls, 'INSERT run').params[2], 'P');
    assert.deepEqual(call(pool.clientCalls, 'SELECT deletable cases').params, [22, [7]]);
    // The teacher's account email and the linked author email are erased.
    assert.deepEqual(call(pool.clientCalls, 'ERASE case emails').params, [
      ['tom@example.com', 'tom.author@example.com'],
      'anon-teacher-22@anonymous.invalid'
    ]);
    assert.deepEqual(call(pool.clientCalls, 'RERENDER').params, [[30]]);
    assert.deepEqual(call(pool.clientCalls, 'INSERT upload deletions').params, [
      22,
      ['cases/12'],
      [true],
      [0],
      91
    ]);
    assert.equal(steps(pool.clientCalls).some((step) => step.startsWith('TRANSFER')), false);
    assert.deepEqual(auditParams(pool.clientCalls), [[7, 'account.forget', 22, 'succeeded', null, 'P']]);

    assert.deepEqual(result, {
      id: 22,
      status: 'anonymized',
      runId: 91,
      recipientId: null,
      activitiesFinished: 2,
      materials: {
        deleted: { cases: 1, designs: 1 },
        transferred: { cases: 0, designs: 0, activities: 0 },
        kept: { cases: 0, designs: 0, activities: 0 },
        authorEmails: { cases: 1, authors: 0, designs: 0, rerenders: 0 }
      },
      uploadDeletions: 1,
      erasureRequests: [
        { serviceId: 'argumentation-tutor', status: 'pending', attempts: 0 },
        { serviceId: 'polyadic-agent', status: 'pending', attempts: 0 }
      ]
    });
    assert.equal(pool.released, 1);
  });

  it('locks the teacher and the recipient in id order and transfers what stays', async () => {
    const pool = createFakePool({ deletableDesigns: [], deletableCases: [] });

    const result = await service(pool).forgetTeacher({
      adminUserId: 7,
      userId: 22,
      expectedEmail: STORED_EMAIL,
      recipientId: 40,
      expectedRecipientEmail: 'RITA@example.com',
      finishActivities: finishSucceeding()
    });

    assert.deepEqual(call(pool.clientCalls, 'LOCK accounts').params, [[22, 40]]);
    for (const step of ['TRANSFER cases', 'TRANSFER designs', 'TRANSFER activities', 'TRANSFER differential']) {
      assert.deepEqual(call(pool.clientCalls, step).params, [22, 40], step);
    }
    assert.equal(steps(pool.clientCalls).includes('DELETE designs'), false);
    assert.equal(steps(pool.clientCalls).includes('DELETE cases'), false);
    assert.equal(steps(pool.clientCalls).includes('INSERT upload deletions'), false);
    assert.equal(result.recipientId, 40);
    assert.deepEqual(result.materials.transferred, { cases: 2, designs: 3, activities: 4 });
  });

  it('delays the deletion of a case directory the PDF worker may still be writing', async () => {
    const pool = createFakePool({
      deletableDesigns: [],
      deletableCases: [{
        id: 12,
        pdf_path: '/uploads/legacy/case-12.pdf',
        source_path: '/uploads/legacy/case-12.pdf',
        manifest_path: null,
        render_status: 'processing'
      }]
    });

    await service(pool).forgetTeacher({
      adminUserId: 7,
      userId: 22,
      expectedEmail: STORED_EMAIL,
      finishActivities: finishSucceeding()
    });

    assert.deepEqual(call(pool.clientCalls, 'INSERT upload deletions').params, [
      22,
      ['cases/12', 'legacy/case-12.pdf'],
      [true, false],
      [600, 600],
      91
    ]);
  });

  for (const [label, accounts, options, code] of [
    ['an anonymized account', [{ ...TEACHER, anonymized_at: '2026-01-01T00:00:00Z' }], {},
      ACCOUNT_FORGETTING_ERRORS.accountAnonymized],
    ['a student', [{ ...TEACHER, role: 'A' }], {}, ACCOUNT_FORGETTING_ERRORS.notATeacher],
    ['an administrator', [{ ...TEACHER, role: 'S' }], {}, ACCOUNT_FORGETTING_ERRORS.notATeacher],
    ['an account whose email changed', [TEACHER], { expectedEmail: 'other@example.com' },
      ACCOUNT_FORGETTING_ERRORS.accountChanged],
    ['a recipient that does not exist', [TEACHER], { recipientId: 41, expectedRecipientEmail: RECIPIENT_EMAIL },
      ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['a recipient that is a student', [TEACHER, { ...RECIPIENT, role: 'A' }],
      { recipientId: 40, expectedRecipientEmail: RECIPIENT_EMAIL }, ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['an inactive recipient', [TEACHER, { ...RECIPIENT, active: false }],
      { recipientId: 40, expectedRecipientEmail: RECIPIENT_EMAIL }, ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['an anonymized recipient', [TEACHER, { ...RECIPIENT, anonymized_at: '2026-01-01T00:00:00Z' }],
      { recipientId: 40, expectedRecipientEmail: RECIPIENT_EMAIL }, ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['a recipient whose email changed', [TEACHER, RECIPIENT],
      { recipientId: 40, expectedRecipientEmail: 'other@example.com' }, ACCOUNT_FORGETTING_ERRORS.recipientChanged]
  ]) {
    it(`refuses ${label} before finishing any activity, and records the refusal`, async () => {
      const pool = createFakePool({ accounts });
      const finished = [];

      await assert.rejects(
        service(pool).forgetTeacher({
          adminUserId: 7,
          userId: 22,
          expectedEmail: STORED_EMAIL,
          finishActivities: finishSucceeding(finished),
          ...options
        }),
        { code }
      );

      assert.deepEqual(finished, []);
      assert.deepEqual(pool.clientCalls, []);
      assert.deepEqual(steps(pool.poolCalls), ['READ accounts', 'INSERT audit']);
      assert.deepEqual(auditParams(pool.poolCalls), [[7, 'account.forget', 22, 'refused', code, 'P']]);
    });
  }

  for (const [label, recipientId] of [['itself', 22], ['an invalid id', 'abc'], ['zero', 0]]) {
    it(`rejects a recipient that is ${label} before touching the database`, async () => {
      const pool = createFakePool();

      await assert.rejects(
        service(pool).forgetTeacher({
          adminUserId: 7,
          userId: 22,
          expectedEmail: STORED_EMAIL,
          recipientId,
          expectedRecipientEmail: RECIPIENT_EMAIL,
          finishActivities: finishSucceeding()
        }),
        { code: ACCOUNT_FORGETTING_ERRORS.invalidRecipient }
      );
      assert.deepEqual(pool.poolCalls, []);
    });
  }

  it('stops, anonymizing nothing, when ethicapp could not finish the activities', async () => {
    const pool = createFakePool();

    await assert.rejects(
      service(pool).forgetTeacher({
        adminUserId: 7,
        userId: 22,
        expectedEmail: STORED_EMAIL,
        finishActivities: async () => ({
          ok: false,
          error: 'finish_incomplete',
          finished: [3],
          skipped: [],
          failed: [{ sessionId: 4, error: 'finish_failed' }]
        })
      }),
      { code: ACCOUNT_FORGETTING_ERRORS.activitiesNotFinished, reason: 'finish_incomplete', failedActivities: 1 }
    );

    assert.deepEqual(pool.clientCalls, []);
    assert.deepEqual(auditParams(pool.poolCalls), [
      [7, 'account.forget', 22, 'failed', 'ACTIVITIES_NOT_FINISHED', 'P']
    ]);
  });

  it('records ethicapp\'s refusal of a non-teacher as a refusal', async () => {
    const pool = createFakePool();

    await assert.rejects(
      service(pool).forgetTeacher({
        adminUserId: 7,
        userId: 22,
        expectedEmail: STORED_EMAIL,
        finishActivities: async () => ({ ok: false, error: 'not_a_teacher' })
      }),
      { code: ACCOUNT_FORGETTING_ERRORS.notATeacher }
    );
    assert.deepEqual(auditParams(pool.poolCalls), [[7, 'account.forget', 22, 'refused', 'NOT_A_TEACHER', 'P']]);
  });

  it('refuses OPEN_ACTIVITIES when an activity is open again once the teacher is locked', async () => {
    const pool = createFakePool({ openActivities: 1 });

    await assert.rejects(
      service(pool).forgetTeacher({
        adminUserId: 7,
        userId: 22,
        expectedEmail: STORED_EMAIL,
        finishActivities: finishSucceeding()
      }),
      { code: ACCOUNT_FORGETTING_ERRORS.openActivities }
    );

    assert.deepEqual(steps(pool.clientCalls), [
      'BEGIN', 'LOCK accounts', 'COUNT open activities', 'INSERT audit', 'COMMIT'
    ]);
    assert.deepEqual(auditParams(pool.clientCalls), [[7, 'account.forget', 22, 'refused', 'OPEN_ACTIVITIES', 'P']]);
  });

  it('refuses inside the transaction an account that changed after the activities were finished', async () => {
    const accounts = [TEACHER];
    const pool = createFakePool({ accounts });

    await assert.rejects(
      service(pool).forgetTeacher({
        adminUserId: 7,
        userId: 22,
        expectedEmail: STORED_EMAIL,
        finishActivities: async () => {
          accounts[0] = { ...TEACHER, mail: 'new@example.com' };
          return { ok: true, finished: [], skipped: [], failed: [] };
        }
      }),
      { code: ACCOUNT_FORGETTING_ERRORS.accountChanged }
    );

    assert.deepEqual(steps(pool.clientCalls), ['BEGIN', 'LOCK accounts', 'INSERT audit', 'COMMIT']);
  });

  it('rolls everything back on a failure and records it apart, best effort', async () => {
    const pool = createFakePool({ failOn: 'ERASE design emails' });

    await assert.rejects(
      service(pool).forgetTeacher({
        adminUserId: 7,
        userId: 22,
        expectedEmail: STORED_EMAIL,
        finishActivities: finishSucceeding()
      }),
      { code: '40P01' }
    );

    assert.equal(steps(pool.clientCalls).at(-1), 'ROLLBACK');
    assert.equal(steps(pool.clientCalls).includes('COMMIT'), false);
    assert.deepEqual(auditParams(pool.poolCalls), [[7, 'account.forget', 22, 'failed', 'UNEXPECTED_ERROR', 'P']]);
    assert.equal(pool.released, 1);
  });

  it('reports a missing teacher without recording anything', async () => {
    const pool = createFakePool({ accounts: [] });

    await assert.rejects(
      service(pool).forgetTeacher({
        adminUserId: 7,
        userId: 22,
        expectedEmail: STORED_EMAIL,
        finishActivities: finishSucceeding()
      }),
      { code: ACCOUNT_FORGETTING_ERRORS.userNotFound }
    );
    assert.deepEqual(auditParams(pool.poolCalls), []);
  });
});

describe('previewTeacherForgetting', () => {
  it('counts the materials in one read-only snapshot and asks ethicapp for the open activities', async () => {
    const pool = createFakePool({ openActivities: 1 });

    const preview = await service(pool).previewTeacherForgetting({
      userId: '22',
      fetchOpenActivities: async () => ({ ok: true, count: 2, sessionIds: [3, 4] })
    });

    assert.deepEqual(preview, {
      userId: 22,
      openActivities: { ok: true, count: 2 },
      cases: { delete: 1, keep: 4 },
      designs: { delete: 1, keep: 3 },
      activities: 3,
      copiesByOthers: { cases: 2, designs: 1 }
    });
    assert.deepEqual(steps(pool.clientCalls), [
      'BEGIN READ ONLY',
      'READ accounts',
      'SELECT deletable designs',
      'SELECT deletable cases',
      'COUNT totals',
      'COUNT open activities',
      'COMMIT'
    ]);
    assert.equal(steps(pool.clientCalls).some((step) => /FOR UPDATE/.test(step)), false);
  });

  it('falls back to the database count when ethicapp cannot answer', async () => {
    const pool = createFakePool({ openActivities: 1 });

    const preview = await service(pool).previewTeacherForgetting({
      userId: 22,
      fetchOpenActivities: async () => ({ ok: false, error: 'unreachable' })
    });

    assert.deepEqual(preview.openActivities, { ok: false, error: 'unreachable', count: 1 });
  });

  for (const [label, accounts, code] of [
    ['a missing account', [], ACCOUNT_FORGETTING_ERRORS.userNotFound],
    ['a student', [{ ...TEACHER, role: 'A' }], ACCOUNT_FORGETTING_ERRORS.notATeacher],
    ['an anonymized teacher', [{ ...TEACHER, anonymized_at: '2026-01-01T00:00:00Z' }],
      ACCOUNT_FORGETTING_ERRORS.accountAnonymized]
  ]) {
    it(`refuses ${label}`, async () => {
      const pool = createFakePool({ accounts });

      await assert.rejects(
        service(pool).previewTeacherForgetting({ userId: 22, fetchOpenActivities: async () => ({ ok: true, count: 0 }) }),
        { code }
      );
      assert.equal(steps(pool.clientCalls).at(-1), 'ROLLBACK');
      assert.equal(pool.released, 1);
    });
  }
});
