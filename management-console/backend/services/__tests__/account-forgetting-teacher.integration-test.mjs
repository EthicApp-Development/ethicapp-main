// Integration tests for forgetting a teacher (V32, #877), against a real
// PostgreSQL database with migrations V1-V32 applied: the transaction and the
// materials (deleted, transferred or kept), the author emails erased in the
// teacher's materials and in other teachers' copies, the refusals, the race
// with an activity opened while the teacher is being forgotten, concurrent
// forgettings and edits, the preview, and the indexes V32 adds.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. ethicapp's finishing of the activities (#881) is
// a fake; everything else runs against the database. The tests insert
// accounts, materials, runs and audit events, and never remove them.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { ACCOUNT_FORGETTING_ERRORS, createAccountForgettingService } from '../account-forgetting.service.js';
import { updateUserById } from '../user.service.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

const ADMIN_USER_ID = 1;
const PLACEHOLDER = '******';
const FINISHED = 3;
const silentLogger = { error: () => {} };

let pool = null;

function getPool() {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
  return pool;
}

async function query(sql, params = []) {
  return (await getPool().query(sql, params)).rows;
}

async function one(sql, params = []) {
  return (await query(sql, params))[0];
}

test.after(async () => {
  await pool?.end();
});

function service() {
  return createAccountForgettingService({ pool: getPool(), env: {}, logger: silentLogger });
}

// ethicapp's finishing of the teacher's open activities (#881), as the
// internal endpoint does it: every session of the teacher that is not
// finished becomes finished.
function finishActivitiesOf(teacherId, { before = async () => {} } = {}) {
  return async () => {
    await before();
    const finished = await query(
      'UPDATE sessions SET status = $2, current_stage = NULL WHERE creator = $1 AND status IS DISTINCT FROM $2 RETURNING id',
      [teacherId, FINISHED]
    );
    return { ok: true, error: null, finished: finished.map((row) => row.id), skipped: [], failed: [] };
  };
}

async function insertUser({ role = 'P', active = true, anonymized = false, firstname = 'Tom', lastname = 'Teacher' } = {}) {
  const mail = `it-877-${randomUUID()}@example.com`;
  return one(
    `
      INSERT INTO users (name, firstname, lastname, rut, mail, role, active, email_confirmed,
                         password_bcrypt, anonymized_at)
      VALUES ($1 || ' ' || $2, $1, $2, $3, $4, $5, $6, true, 'bcrypt-hash', CASE WHEN $7 THEN NOW() END)
      RETURNING id, mail, session_version
    `,
    [firstname, lastname, randomUUID(), mail, role, active, anonymized]
  );
}

async function insertCase(creatorId, {
  visibility = 'private',
  authorEmail = null,
  originalCaseId = null,
  pdfPath = null,
  render = null
} = {}) {
  const row = await one(
    `
      INSERT INTO ethical_cases (title, author_firstname, author_lastname, author_email, pdf_path, creator,
                                 visibility, original_case_id, imported_from_case_id)
      VALUES ($1, 'Tom', 'Teacher', $2, 'pending', $3, $4, $5, $5)
      RETURNING id
    `,
    [`Case ${randomUUID()}`, authorEmail, creatorId, visibility, originalCaseId]
  );
  const storedPdfPath = pdfPath ?? `/uploads/cases/${row.id}/case.pdf`;
  await query('UPDATE ethical_cases SET pdf_path = $2 WHERE id = $1', [row.id, storedPdfPath]);

  if (render) {
    await query(
      `
        INSERT INTO pdf_render_jobs (owner_type, owner_id, source_path, status, manifest_path, completed_at)
        VALUES ('case', $1, $2, $3, $4, CASE WHEN $3 = 'completed' THEN now() END)
      `,
      [row.id, storedPdfPath, render, render === 'completed' ? `/uploads/cases/${row.id}/representation.json` : null]
    );
  }

  return Number(row.id);
}

async function insertDesign(creatorId, { visibility = 'private', caseId = null, originalDesignId = null, email = null } = {}) {
  const design = { metainfo: { title: `Design ${randomUUID()}`, author: 'Tom Teacher', institution: 'U', creation_date: 1 } };
  if (email) {
    design.metainfo.email = email;
  }
  const row = await one(
    `
      INSERT INTO designs (creator, design, visibility, public, case_id, original_design_id, imported_from_design_id)
      VALUES ($1, $2::jsonb, $3::varchar, $3::varchar = 'public', $4, $5, $5)
      RETURNING id
    `,
    [creatorId, JSON.stringify(design), visibility, caseId, originalDesignId]
  );
  return Number(row.id);
}

async function insertActivity(creatorId, designId, { status = FINISHED } = {}) {
  const session = await one(
    "INSERT INTO sessions (name, creator, status, type) VALUES ('Activity', $1, $2, 'T') RETURNING id",
    [creatorId, status]
  );
  await query('INSERT INTO activity (design, session) VALUES ($1, $2)', [designId, session.id]);
  return Number(session.id);
}

// A teacher with materials of every kind, and another teacher who copied
// some of them.
async function teacherWithMaterials() {
  const teacher = await insertUser();
  const other = await insertUser({ firstname: 'Olga', lastname: 'Other' });

  // Private, unused and uncopied: deleted, with a design that uses it.
  const deletedCase = await insertCase(teacher.id, { authorEmail: teacher.mail, render: 'completed' });
  const deletedDesign = await insertDesign(teacher.id, { caseId: deletedCase, email: teacher.mail });
  await query("INSERT INTO ethical_case_videos (case_id, position, youtube_video_id) VALUES ($1, 1, 'dQw4w9WgXcQ')", [deletedCase]);
  await query("INSERT INTO case_analyses (case_id, service_id) VALUES ($1, 'case-analyst')", [deletedCase]);
  await query("INSERT INTO design_analyses (design_id, service_id) VALUES ($1, 'design-analyst')", [deletedDesign]);
  // A co-author named only on the deleted case.
  const coAuthor = await one(
    "INSERT INTO ethical_case_author (author_firstname, author_lastname, author_email) VALUES ('Carla', 'Coauthor', $1) RETURNING id",
    [`co-${randomUUID()}@example.com`]
  );
  await query('INSERT INTO ethical_cases_authors (case_id, author_id, author_order) VALUES ($1, $2, 2)', [deletedCase, coAuthor.id]);

  // Public: kept, and its manifest rendered again without the email.
  const publicCase = await insertCase(teacher.id, { visibility: 'public', authorEmail: teacher.mail, render: 'completed' });
  // The teacher's author entry, linked to the account, on two cases.
  const author = await one(
    "INSERT INTO ethical_case_author (author_firstname, author_lastname, author_email) VALUES ('Tom', 'Teacher', $1) RETURNING id",
    [teacher.mail.toUpperCase()]
  );
  for (const caseId of [deletedCase, publicCase]) {
    await query(
      'INSERT INTO ethical_cases_authors (case_id, author_id, user_id, is_primary) VALUES ($1, $2, $3, true)',
      [caseId, author.id, teacher.id]
    );
  }

  // Private but copied by the other teacher: kept. The copy points to the
  // source PDF, as a copy whose PDF copy failed does.
  const copiedCase = await insertCase(teacher.id, { authorEmail: teacher.mail });
  const caseCopy = await insertCase(other.id, {
    originalCaseId: copiedCase,
    authorEmail: teacher.mail,
    pdfPath: `/uploads/cases/${copiedCase}/case.pdf`
  });

  // Private, used in a finished activity: kept.
  const usedDesign = await insertDesign(teacher.id);
  const finishedActivity = await insertActivity(teacher.id, usedDesign);
  await query(
    "INSERT INTO differential (tleft, tright, orden, creator, sesid) VALUES ('a', 'b', 1, $1, $2)",
    [teacher.id, finishedActivity]
  );
  // Private, copied by the other teacher: kept; the copy keeps the author's
  // name and loses the email.
  const copiedDesign = await insertDesign(teacher.id, { email: teacher.mail });
  const designCopy = await insertDesign(other.id, { originalDesignId: copiedDesign, email: teacher.mail });

  // The other teacher's own case, by someone else: unchanged.
  const unrelatedCase = await insertCase(other.id, { authorEmail: other.mail });

  // A chat message the teacher posted, and a classmate's.
  const student = await insertUser({ role: 'A' });
  await query('INSERT INTO chat (uid, content, sesid) VALUES ($1, $2, $4), ($3, $5, $4)', [
    teacher.id, 'Teacher message', student.id, finishedActivity, 'Student message'
  ]);

  await query(
    `
      UPDATE users
      SET profile_image_path = '/uploads/user-profiles/' || id || '/user-' || id || '-original.jpg',
          profile_image_topbar_path = '/uploads/user-profiles/' || id || '/user-' || id || '-topbar-64.jpg'
      WHERE id = $1
    `,
    [teacher.id]
  );
  await query(
    "INSERT INTO user_passkeys (user_id, credential_id, credential_public_key) VALUES ($1, $2, '\\x00')",
    [teacher.id, randomUUID()]
  );

  return {
    teacher,
    other,
    student,
    deletedCase,
    deletedDesign,
    coAuthor: Number(coAuthor.id),
    publicCase,
    author: Number(author.id),
    copiedCase,
    caseCopy,
    usedDesign,
    finishedActivity,
    copiedDesign,
    designCopy,
    unrelatedCase
  };
}

async function existing(table, ids) {
  const rows = await query(`SELECT id FROM ${table} WHERE id = ANY($1::integer[]) ORDER BY id`, [ids]);
  return rows.map((row) => Number(row.id));
}

async function forget(teacher, options = {}) {
  return service().forgetTeacher({
    adminUserId: ADMIN_USER_ID,
    userId: teacher.id,
    expectedEmail: teacher.mail,
    finishActivities: finishActivitiesOf(teacher.id),
    ...options
  });
}

test('V32: forgetting a teacher deletes, keeps and erases as decided, in one transaction', {
  skip: SKIP_REASON
}, async () => {
  const m = await teacherWithMaterials();
  const openActivity = await insertActivity(m.teacher.id, m.usedDesign, { status: 2 });

  const result = await forget(m.teacher, { expectedEmail: m.teacher.mail.toUpperCase() });

  assert.equal(result.status, 'anonymized');
  assert.equal(result.activitiesFinished, 1);
  assert.deepEqual(result.materials.deleted, { cases: 1, designs: 1 });
  assert.deepEqual(result.materials.kept, { cases: 2, designs: 2, activities: 2 });
  assert.equal(result.uploadDeletions, 3);

  // The open activity was finished first; activities are always kept.
  const sessions = await query('SELECT id, status, creator FROM sessions WHERE id = ANY($1) ORDER BY id', [
    [m.finishedActivity, openActivity]
  ]);
  assert.deepEqual(sessions.map((row) => [row.status, row.creator]), [[FINISHED, m.teacher.id], [FINISHED, m.teacher.id]]);

  // Deleted, with their dependent rows.
  assert.deepEqual(await existing('ethical_cases', [m.deletedCase]), []);
  assert.deepEqual(await existing('designs', [m.deletedDesign]), []);
  for (const [table, column, id] of [
    ['ethical_case_videos', 'case_id', m.deletedCase],
    ['case_analyses', 'case_id', m.deletedCase],
    ['pdf_render_jobs', 'owner_id', m.deletedCase],
    ['ethical_cases_authors', 'case_id', m.deletedCase],
    ['design_analyses', 'design_id', m.deletedDesign]
  ]) {
    assert.equal((await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [id])).n, 0, table);
  }
  assert.deepEqual(await existing('ethical_case_author', [m.coAuthor]), [], 'an author no case names any more');

  // Kept: the public case, the copied case and design, the used design.
  assert.deepEqual(await existing('ethical_cases', [m.publicCase, m.copiedCase]), [m.publicCase, m.copiedCase].sort((a, b) => a - b));
  assert.deepEqual(await existing('designs', [m.usedDesign, m.copiedDesign]), [m.usedDesign, m.copiedDesign].sort((a, b) => a - b));

  // The teacher's email is gone everywhere; the author names stay.
  const anonymousEmail = `anon-teacher-${m.teacher.id}@anonymous.invalid`;
  const cases = await query(
    'SELECT id, creator, author_firstname, author_lastname, author_email, original_case_id FROM ethical_cases WHERE id = ANY($1) ORDER BY id',
    [[m.publicCase, m.copiedCase, m.caseCopy, m.unrelatedCase]]
  );
  for (const row of cases) {
    const expectedEmail = row.id === m.unrelatedCase ? m.other.mail : anonymousEmail;
    assert.equal(row.author_email, expectedEmail, `case ${row.id}`);
    assert.deepEqual([row.author_firstname, row.author_lastname], ['Tom', 'Teacher']);
  }
  const copy = cases.find((row) => row.id === m.caseCopy);
  assert.equal(copy.creator, m.other.id);
  assert.equal(copy.original_case_id, m.copiedCase);
  const author = await one('SELECT author_firstname, author_lastname, author_email FROM ethical_case_author WHERE id = $1', [m.author]);
  assert.deepEqual(author, {
    author_firstname: 'Tom',
    author_lastname: 'Teacher',
    author_email: `anon-author-${m.author}@anonymous.invalid`
  });
  const designs = await query('SELECT id, creator, design FROM designs WHERE id = ANY($1) ORDER BY id', [[m.copiedDesign, m.designCopy]]);
  for (const row of designs) {
    assert.equal(row.design.metainfo.email, undefined, `design ${row.id}`);
    assert.equal(row.design.metainfo.author, 'Tom Teacher');
  }
  assert.equal(designs.find((row) => row.id === m.designCopy).creator, m.other.id);
  const leftovers = await one(
    `
      SELECT
          (SELECT count(*)::int FROM ethical_cases WHERE lower(author_email) = lower($1)) AS cases,
          (SELECT count(*)::int FROM ethical_case_author WHERE lower(author_email) = lower($1)) AS authors,
          (SELECT count(*)::int FROM designs WHERE lower(design::text) LIKE '%' || lower($1) || '%') AS designs,
          (SELECT count(*)::int FROM users WHERE lower(mail) = lower($1)) AS users
    `,
    [m.teacher.mail]
  );
  assert.deepEqual(leftovers, { cases: 0, authors: 0, designs: 0, users: 0 });

  // The kept case with a rendered manifest is rendered again.
  const render = await one('SELECT status, attempt_count, metadata FROM pdf_render_jobs WHERE owner_id = $1', [m.publicCase]);
  assert.equal(render.status, 'pending');
  assert.equal(render.attempt_count, 0);
  assert.equal(render.metadata.reason, 'author_email_erased');

  // The account and its text.
  const user = await one(
    `
      SELECT name, firstname, lastname, mail, rut, active, password_bcrypt, session_version, anonymized_at,
             profile_image_path, anonymization_run_id
      FROM users WHERE id = $1
    `,
    [m.teacher.id]
  );
  assert.equal(user.name, `Former Teacher ${m.teacher.id}`);
  assert.equal(user.mail, anonymousEmail);
  assert.equal(user.active, false);
  assert.equal(user.password_bcrypt, null);
  assert.equal(user.session_version, m.teacher.session_version + 1);
  assert.equal(user.profile_image_path, null);
  assert.ok(user.anonymized_at);
  assert.equal(Number(user.anonymization_run_id), result.runId);
  const chat = await query('SELECT uid, content FROM chat WHERE sesid = $1 ORDER BY id', [m.finishedActivity]);
  assert.deepEqual(chat.map((row) => row.content), [PLACEHOLDER, 'Student message']);
  assert.equal((await one('SELECT count(*)::int AS n FROM user_passkeys WHERE user_id = $1', [m.teacher.id])).n, 0);

  // The background work it leaves for ethicapp.
  const uploads = await query(
    'SELECT path, recursive, status, anonymization_run_id FROM upload_deletion_requests WHERE user_id = $1 ORDER BY path',
    [m.teacher.id]
  );
  assert.deepEqual(uploads.map((row) => [row.path, row.recursive, row.status, Number(row.anonymization_run_id)]), [
    [`cases/${m.deletedCase}`, true, 'pending', result.runId],
    [`user-profiles/${m.teacher.id}/user-${m.teacher.id}-original.jpg`, false, 'pending', result.runId],
    [`user-profiles/${m.teacher.id}/user-${m.teacher.id}-topbar-64.jpg`, false, 'pending', result.runId]
  ]);
  const erasures = await query('SELECT service_id, status FROM user_erasure_requests WHERE user_id = $1 ORDER BY service_id', [m.teacher.id]);
  assert.deepEqual(erasures.map((row) => [row.service_id, row.status]), [
    ['argumentation-tutor', 'pending'],
    ['polyadic-agent', 'pending']
  ]);

  // The run, its event and the audit row.
  const run = await one('SELECT status, target_role, total_accounts, succeeded_accounts FROM student_anonymization_runs WHERE id = $1', [result.runId]);
  assert.deepEqual(run, { status: 'completed', target_role: 'P', total_accounts: 1, succeeded_accounts: 1 });
  const audit = await query(
    "SELECT outcome, reason_code, target_role FROM admin_audit_events WHERE target_user_id = $1 AND action = 'account.forget'",
    [m.teacher.id]
  );
  assert.deepEqual(audit, [{ outcome: 'succeeded', reason_code: null, target_role: 'P' }]);
});

test('V32: a recipient receives the remaining cases, designs and activities', { skip: SKIP_REASON }, async () => {
  const m = await teacherWithMaterials();
  const recipient = await insertUser({ firstname: 'Rita', lastname: 'Recipient' });

  const result = await forget(m.teacher, { recipientId: recipient.id, expectedRecipientEmail: recipient.mail });

  assert.equal(result.recipientId, recipient.id);
  assert.deepEqual(result.materials.transferred, { cases: 2, designs: 2, activities: 1 });
  assert.deepEqual(result.materials.kept, { cases: 0, designs: 0, activities: 0 });
  const owners = await one(
    `
      SELECT
          (SELECT array_agg(DISTINCT creator) FROM ethical_cases WHERE id = ANY($1)) AS cases,
          (SELECT array_agg(DISTINCT creator) FROM designs WHERE id = ANY($2)) AS designs,
          (SELECT array_agg(DISTINCT creator) FROM sessions WHERE id = $3) AS sessions,
          (SELECT array_agg(DISTINCT creator) FROM differential WHERE sesid = $3) AS differential
    `,
    [[m.publicCase, m.copiedCase], [m.usedDesign, m.copiedDesign], m.finishedActivity]
  );
  assert.deepEqual(owners, {
    cases: [recipient.id],
    designs: [recipient.id],
    sessions: [recipient.id],
    differential: [recipient.id]
  });
  // The private, unused and uncopied materials are still deleted, and the
  // copies stay with the teacher who made them.
  assert.deepEqual(await existing('ethical_cases', [m.deletedCase]), []);
  assert.equal((await one('SELECT creator FROM ethical_cases WHERE id = $1', [m.caseCopy])).creator, m.other.id);
  // Nothing of the recipient's account changed.
  const recipientRow = await one('SELECT mail, active, anonymized_at FROM users WHERE id = $1', [recipient.id]);
  assert.deepEqual(recipientRow, { mail: recipient.mail, active: true, anonymized_at: null });
});

test('V32: refusals change nothing, finish no activity, and are recorded', { skip: SKIP_REASON }, async () => {
  const cases = [
    ['a student', async () => ({ account: await insertUser({ role: 'A' }) }), ACCOUNT_FORGETTING_ERRORS.notATeacher],
    ['an anonymized teacher', async () => ({ account: await insertUser({ anonymized: true }) }), ACCOUNT_FORGETTING_ERRORS.accountAnonymized],
    ['a changed email', async () => ({ account: await insertUser(), expectedEmail: 'other@example.com' }), ACCOUNT_FORGETTING_ERRORS.accountChanged],
    ['a student recipient', async () => {
      const recipient = await insertUser({ role: 'A' });
      return { account: await insertUser(), recipientId: recipient.id, expectedRecipientEmail: recipient.mail };
    }, ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['an inactive recipient', async () => {
      const recipient = await insertUser({ active: false });
      return { account: await insertUser(), recipientId: recipient.id, expectedRecipientEmail: recipient.mail };
    }, ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['an anonymized recipient', async () => {
      const recipient = await insertUser({ anonymized: true });
      return { account: await insertUser(), recipientId: recipient.id, expectedRecipientEmail: recipient.mail };
    }, ACCOUNT_FORGETTING_ERRORS.recipientUnavailable],
    ['a recipient whose email changed', async () => {
      const recipient = await insertUser();
      return { account: await insertUser(), recipientId: recipient.id, expectedRecipientEmail: 'old@example.com' };
    }, ACCOUNT_FORGETTING_ERRORS.recipientChanged]
  ];

  for (const [label, setup, code] of cases) {
    const { account, expectedEmail = account.mail, ...options } = await setup();
    const design = await insertDesign(account.id);
    const open = await insertActivity(account.id, design, { status: 2 });
    let finishCalls = 0;

    await assert.rejects(
      service().forgetTeacher({
        adminUserId: ADMIN_USER_ID,
        userId: account.id,
        expectedEmail,
        finishActivities: async () => {
          finishCalls += 1;
          return { ok: true, finished: [], skipped: [], failed: [] };
        },
        ...options
      }),
      { code },
      label
    );

    assert.equal(finishCalls, 0, label);
    assert.equal((await one('SELECT status FROM sessions WHERE id = $1', [open])).status, 2, label);
    assert.deepEqual(await existing('designs', [design]), [design], label);
    const audit = await query(
      "SELECT outcome, reason_code, target_role FROM admin_audit_events WHERE target_user_id = $1 AND action = 'account.forget'",
      [account.id]
    );
    assert.deepEqual(audit, [{ outcome: 'refused', reason_code: code, target_role: 'P' }], label);
  }
});

test('V32: an activity opened while the teacher is being forgotten refuses OPEN_ACTIVITIES', {
  skip: SKIP_REASON
}, async () => {
  const m = await teacherWithMaterials();
  let reopened = null;

  // The teacher starts a new activity right after ethicapp finished theirs.
  const finishActivities = async () => {
    const result = await finishActivitiesOf(m.teacher.id)();
    reopened = await insertActivity(m.teacher.id, m.usedDesign, { status: 1 });
    return result;
  };

  await assert.rejects(forget(m.teacher, { finishActivities }), { code: ACCOUNT_FORGETTING_ERRORS.openActivities });

  const user = await one('SELECT mail, active, anonymized_at FROM users WHERE id = $1', [m.teacher.id]);
  assert.deepEqual(user, { mail: m.teacher.mail, active: true, anonymized_at: null });
  assert.deepEqual(await existing('ethical_cases', [m.deletedCase]), [m.deletedCase]);
  assert.equal((await one('SELECT status FROM sessions WHERE id = $1', [reopened])).status, 1);
  assert.equal((await one('SELECT count(*)::int AS n FROM upload_deletion_requests WHERE user_id = $1', [m.teacher.id])).n, 0);

  // A finishing that did not complete (V30) also counts as open.
  await query('UPDATE sessions SET status = $2 WHERE id = $1', [reopened, FINISHED]);
  await query('INSERT INTO activity_finalizations (session_id) VALUES ($1)', [reopened]);
  await assert.rejects(
    forget(m.teacher, { finishActivities: async () => ({ ok: true, finished: [], skipped: [], failed: [] }) }),
    { code: ACCOUNT_FORGETTING_ERRORS.openActivities }
  );

  // Once it completes, the teacher can be forgotten.
  await query('DELETE FROM activity_finalizations WHERE session_id = $1', [reopened]);
  assert.equal((await forget(m.teacher)).status, 'anonymized');
});

test('V32: ethicapp failing to finish the activities anonymizes nothing', { skip: SKIP_REASON }, async () => {
  const m = await teacherWithMaterials();

  await assert.rejects(
    forget(m.teacher, { finishActivities: async () => ({ ok: false, error: 'unreachable' }) }),
    { code: ACCOUNT_FORGETTING_ERRORS.activitiesNotFinished, reason: 'unreachable' }
  );

  assert.equal((await one('SELECT anonymized_at FROM users WHERE id = $1', [m.teacher.id])).anonymized_at, null);
  const audit = await query(
    "SELECT outcome, reason_code FROM admin_audit_events WHERE target_user_id = $1 AND action = 'account.forget'",
    [m.teacher.id]
  );
  assert.deepEqual(audit, [{ outcome: 'failed', reason_code: 'ACTIVITIES_NOT_FINISHED' }]);
});

test('V32: two concurrent forgettings of the same teacher anonymize it once', { skip: SKIP_REASON }, async () => {
  const m = await teacherWithMaterials();

  const outcomes = await Promise.allSettled([1, 2].map(() => forget(m.teacher)));

  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, ACCOUNT_FORGETTING_ERRORS.accountAnonymized);
  const runs = await one('SELECT count(*)::int AS n FROM student_anonymization_events WHERE user_id = $1', [m.teacher.id]);
  assert.equal(runs.n, 1);
});

test('V32: two teachers forgotten at once, each the other\'s recipient, never deadlock', {
  skip: SKIP_REASON
}, async () => {
  const first = await insertUser();
  const second = await insertUser();
  await insertDesign(first.id, { visibility: 'public' });
  await insertDesign(second.id, { visibility: 'public' });

  const outcomes = await Promise.allSettled([
    forget(first, { recipientId: second.id, expectedRecipientEmail: second.mail }),
    forget(second, { recipientId: first.id, expectedRecipientEmail: first.mail })
  ]);

  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(
    outcomes.find((outcome) => outcome.status === 'rejected').reason.code,
    ACCOUNT_FORGETTING_ERRORS.recipientUnavailable
  );
});

test('V32: an edit that started before the teacher was forgotten cannot undo it', { skip: SKIP_REASON }, async () => {
  const m = await teacherWithMaterials();
  const email = `it-877-${randomUUID()}@example.com`;
  const queryFn = async (sql, params) => {
    if (/^\s*UPDATE users/.test(sql)) {
      await forget(m.teacher);
    }
    return getPool().query(sql, params);
  };

  await assert.rejects(updateUserById(m.teacher.id, {
    firstname: 'Real',
    lastname: 'Name',
    sex: 'M',
    email,
    email_confirmation: email,
    role: 'P',
    active: true
  }, { queryFn }), { message: 'ACCOUNT_ANONYMIZED' });

  const user = await one('SELECT firstname, mail, active FROM users WHERE id = $1', [m.teacher.id]);
  assert.deepEqual(user, { firstname: 'Former', mail: `anon-teacher-${m.teacher.id}@anonymous.invalid`, active: false });
});

test('V32: the preview counts what forgetting would do, without changing anything', { skip: SKIP_REASON }, async () => {
  const m = await teacherWithMaterials();

  const preview = await service().previewTeacherForgetting({
    userId: m.teacher.id,
    fetchOpenActivities: async () => ({ ok: false, error: 'unreachable' })
  });

  assert.deepEqual(preview, {
    userId: m.teacher.id,
    openActivities: { ok: false, error: 'unreachable', count: 0 },
    cases: { delete: 1, keep: 2 },
    designs: { delete: 1, keep: 2 },
    activities: 1,
    copiesByOthers: { cases: 1, designs: 1 }
  });
  assert.deepEqual(await existing('ethical_cases', [m.deletedCase]), [m.deletedCase]);
});

test('V32: student_anonymization_runs accepts teachers, and the audit log a target role', { skip: SKIP_REASON }, async () => {
  await query("INSERT INTO student_anonymization_runs (target_role) VALUES ('P')");
  await assert.rejects(query("INSERT INTO student_anonymization_runs (target_role) VALUES ('S')"), { code: '23514' });
  await assert.rejects(
    query("INSERT INTO admin_audit_events (admin_user_id, action, outcome, target_role) VALUES (1, 'account.forget', 'refused', 'X')"),
    { code: '23514' }
  );
});

test('V32: upload_deletion_requests keeps paths, statuses and codes well formed', { skip: SKIP_REASON }, async () => {
  const userId = (await insertUser()).id;
  const insert = (pathValue, extra = '', values = '') => query(
    `INSERT INTO upload_deletion_requests (user_id, path${extra}) VALUES ($1, $2${values})`,
    [userId, pathValue]
  );

  await insert(`cases/${userId}`);
  for (const invalid of ['cases', '/cases/1', 'cases/../etc', 'cases/./1', 'cases/1/my file.pdf', 'cases\\1']) {
    await assert.rejects(insert(invalid), { code: '23514' }, invalid);
  }
  await assert.rejects(insert('cases/2', ', status', ", 'done'"), { code: '23514' }, 'done needs completed_at');
  await insert('cases/3', ', status, completed_at', ", 'skipped', now()");
  await assert.rejects(insert('cases/4', ', last_error', ", 'EACCES: permission denied'"), { code: '23514' });
  await assert.rejects(insert(`cases/${userId}`), { code: '23505' });
});

test('V32: the materials statements use the teacher indexes (EXPLAIN)', { skip: SKIP_REASON }, async () => {
  const statements = [
    ['SELECT id FROM sessions WHERE creator = $1', 'idx_sessions_creator'],
    ['SELECT id FROM designs WHERE creator = $1', 'idx_designs_creator'],
    ['SELECT id FROM pdf_render_jobs WHERE owner_id = $1', 'idx_pdf_render_jobs_owner_id'],
    ['SELECT id FROM activity_report_exports WHERE design_id = $1', 'idx_activity_report_exports_design_id']
  ];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    await client.query("SET LOCAL plan_cache_mode = 'force_generic_plan'");

    for (const [sql, indexName] of statements) {
      const name = `explain_${indexName}`;
      await client.query(`PREPARE ${name} (integer) AS ${sql}`);
      const plan = (await client.query(`EXPLAIN EXECUTE ${name}(1)`)).rows.map((row) => row['QUERY PLAN']).join('\n');
      assert.match(plan, new RegExp(`Index (Only )?Scan using ${indexName}|Bitmap Index Scan on ${indexName}`), plan);
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
