// Integration tests for forgetting a student (V29, #876), against a real
// PostgreSQL database with migrations V1-V29 applied: the on-demand
// transaction, the per-account step of the scheduled job, the
// user_erasure_requests table, and the indexes the anonymization uses.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts, responses, AI service
// rows, anonymization runs and audit events, and never remove them.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { ACCOUNT_FORGETTING_ERRORS, createAccountForgettingService } from '../account-forgetting.service.js';
import { updateUserById } from '../user.service.js';
import {
  anonymizeStudentAccount,
  createAnonymizationRun,
  finalizeAnonymizationRun
} from '../../helpers/student-anonymization-helper.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

const ADMIN_USER_ID = 1;
const PLACEHOLDER = '******';
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

function service() {
  return createAccountForgettingService({ pool: getPool(), env: {}, logger: silentLogger });
}

async function insertUser({ role = 'A', anonymized = false } = {}) {
  const mail = `it-876-${randomUUID()}@example.com`;
  const [row] = await query(
    `
      INSERT INTO users (name, firstname, lastname, rut, mail, role, active, email_confirmed,
                         password_bcrypt, anonymized_at)
      VALUES ('Ana Student', 'Ana', 'Student', $1, $2, $3, true, true, 'bcrypt-hash',
              CASE WHEN $4 THEN NOW() END)
      RETURNING id, mail, session_version
    `,
    [randomUUID(), mail, role, anonymized]
  );
  return row;
}

// Written responses and AI service work of `userId`, plus a classmate's
// chat message that must stay as it is.
async function insertStudentData(userId, classmateId) {
  await query('INSERT INTO chat (uid, content) VALUES ($1, $2), ($3, $4)', [
    userId, 'My chat message', classmateId, 'Classmate message'
  ]);
  await query('INSERT INTO differential_chat (uid, content) VALUES ($1, $2)', [userId, 'Differential chat']);
  await query('INSERT INTO differential_selection (uid, sel, comment) VALUES ($1, 3, $2)', [userId, 'Justification']);
  await query('INSERT INTO actor_selection (uid, description) VALUES ($1, $2)', [userId, 'Actor justification']);

  const [job] = await query(
    `
      INSERT INTO external_service_jobs (service_id, hook_name, status, user_id, outbound_payload)
      VALUES ('argumentation-tutor-system', 'student-response-submitted', 'completed', $1, $2::jsonb)
      RETURNING id
    `,
    [userId, JSON.stringify({ argument: 'Outbound argument' })]
  );
  await query(
    `
      INSERT INTO external_service_results
        (job_id, service_id, status, user_id, raw_payload, sanitized_payload, adapter_result)
      VALUES ($1, 'argumentation-tutor-system', 'completed', $2, $3::jsonb, $4::jsonb, $5::jsonb)
    `,
    [
      job.id,
      userId,
      JSON.stringify({ payload: { argumentPreview: 'Creo que deberían bajar el precio.', scores: { claim: 1 } } }),
      JSON.stringify({ summary: 'Sanitized text' }),
      JSON.stringify({ status: 'completed', payload: { claimTypeRationale: 'Quotes the student', claimTypeId: 2 } })
    ]
  );
}

async function erasureRequestsOf(userId) {
  return query(
    `
      SELECT service_id, status, attempts, last_error, completed_at, anonymization_run_id
      FROM user_erasure_requests
      WHERE user_id = $1
      ORDER BY service_id
    `,
    [userId]
  );
}

test('V29: forgetting a student anonymizes the account and its text and records the erasure requests', {
  skip: SKIP_REASON
}, async () => {
  const student = await insertUser();
  const classmate = await insertUser();
  await insertStudentData(student.id, classmate.id);

  const result = await service().forgetStudent({
    adminUserId: ADMIN_USER_ID,
    userId: student.id,
    expectedEmail: student.mail.toUpperCase()
  });

  assert.equal(result.status, 'anonymized');

  const [user] = await query(
    `
      SELECT name, mail, rut, active, password_bcrypt, session_version, anonymized_at,
             anonymization_run_id
      FROM users WHERE id = $1
    `,
    [student.id]
  );
  assert.equal(user.name, `Anonymous Student ${student.id}`);
  assert.equal(user.mail, `anon-student-${student.id}@anonymous.invalid`);
  assert.equal(user.active, false);
  assert.equal(user.password_bcrypt, null);
  assert.equal(user.session_version, student.session_version + 1);
  assert.ok(user.anonymized_at);
  assert.equal(Number(user.anonymization_run_id), result.runId);

  const texts = await query(
    `
      SELECT 'chat' AS source, uid, content AS text FROM chat WHERE uid = ANY($1)
      UNION ALL SELECT 'differential_chat', uid, content FROM differential_chat WHERE uid = $2
      UNION ALL SELECT 'differential_selection', uid, comment FROM differential_selection WHERE uid = $2
      UNION ALL SELECT 'actor_selection', uid, description FROM actor_selection WHERE uid = $2
    `,
    [[student.id, classmate.id], student.id]
  );
  for (const row of texts) {
    assert.equal(row.text, row.uid === classmate.id ? 'Classmate message' : PLACEHOLDER, row.source);
  }
  assert.equal(texts.length, 5);

  const [stored] = await query(
    'SELECT raw_payload, sanitized_payload, adapter_result FROM external_service_results WHERE user_id = $1',
    [student.id]
  );
  assert.deepEqual(stored.raw_payload, { payload: { argumentPreview: PLACEHOLDER, scores: { claim: 1 } } });
  assert.deepEqual(stored.sanitized_payload, { summary: PLACEHOLDER });
  assert.deepEqual(stored.adapter_result, {
    status: PLACEHOLDER,
    payload: { claimTypeRationale: PLACEHOLDER, claimTypeId: 2 }
  });
  const [job] = await query('SELECT outbound_payload FROM external_service_jobs WHERE user_id = $1', [student.id]);
  assert.deepEqual(job.outbound_payload, { argument: PLACEHOLDER });

  const [run] = await query(
    `
      SELECT status, total_accounts, succeeded_accounts, triggered_by, process_name, finished_at
      FROM student_anonymization_runs WHERE id = $1
    `,
    [result.runId]
  );
  assert.deepEqual(
    { ...run, finished_at: Boolean(run.finished_at) },
    {
      status: 'completed',
      total_accounts: 1,
      succeeded_accounts: 1,
      triggered_by: `admin-user:${ADMIN_USER_ID}`,
      process_name: 'mng-console',
      finished_at: true
    }
  );
  const events = await query(
    'SELECT status FROM student_anonymization_events WHERE run_id = $1 AND user_id = $2',
    [result.runId, student.id]
  );
  assert.deepEqual(events, [{ status: 'succeeded' }]);

  const requests = await erasureRequestsOf(student.id);
  assert.deepEqual(requests.map((request) => [request.service_id, request.status, request.attempts]), [
    ['argumentation-tutor', 'pending', 0],
    ['polyadic-agent', 'pending', 0]
  ]);
  assert.ok(requests.every((request) => Number(request.anonymization_run_id) === result.runId));

  const audit = await query(
    'SELECT action, outcome, reason_code FROM admin_audit_events WHERE target_user_id = $1',
    [student.id]
  );
  assert.deepEqual(audit, [{ action: 'account.forget', outcome: 'succeeded', reason_code: null }]);
});

test('V29: teachers, administrators and anonymized accounts are refused and left unchanged', {
  skip: SKIP_REASON
}, async () => {
  for (const [options, code] of [
    [{ role: 'P' }, ACCOUNT_FORGETTING_ERRORS.notAStudent],
    [{ role: 'S' }, ACCOUNT_FORGETTING_ERRORS.notAStudent],
    [{ anonymized: true }, ACCOUNT_FORGETTING_ERRORS.accountAnonymized]
  ]) {
    const account = await insertUser(options);

    await assert.rejects(
      service().forgetStudent({ adminUserId: ADMIN_USER_ID, userId: account.id, expectedEmail: account.mail }),
      { code }
    );

    const [user] = await query('SELECT mail, active FROM users WHERE id = $1', [account.id]);
    assert.deepEqual(user, { mail: account.mail, active: true });
    assert.deepEqual(await erasureRequestsOf(account.id), []);
    const audit = await query(
      'SELECT outcome, reason_code FROM admin_audit_events WHERE target_user_id = $1',
      [account.id]
    );
    assert.deepEqual(audit, [{ outcome: 'refused', reason_code: code }]);
  }
});

test('V29: the scheduled job\'s per-account step gives the same coverage and leaves the requests pending', {
  skip: SKIP_REASON
}, async () => {
  const student = await insertUser();
  const classmate = await insertUser();
  await insertStudentData(student.id, classmate.id);

  const client = await getPool().connect();
  let runId;
  try {
    runId = await createAnonymizationRun(client, {
      dryRun: false,
      placeholderText: PLACEHOLDER,
      triggeredBy: 'integration-test',
      processName: 'student-anonymization-job'
    }, 1);
  } finally {
    client.release();
  }

  const result = await anonymizeStudentAccount(getPool(), runId, { id: student.id }, { placeholderText: PLACEHOLDER });
  const finalizer = await getPool().connect();
  try {
    await finalizeAnonymizationRun(finalizer, runId, { total: 1, succeeded: 1, failed: 0 });
  } finally {
    finalizer.release();
  }

  assert.equal(result.status, 'succeeded');
  const [stored] = await query('SELECT raw_payload FROM external_service_results WHERE user_id = $1', [student.id]);
  assert.equal(stored.raw_payload.payload.argumentPreview, PLACEHOLDER);
  assert.deepEqual(
    (await erasureRequestsOf(student.id)).map((request) => [request.service_id, request.status]),
    [['argumentation-tutor', 'pending'], ['polyadic-agent', 'pending']]
  );
});

test('V29: two concurrent forgettings of the same student anonymize it once', {
  skip: SKIP_REASON
}, async () => {
  const student = await insertUser();

  const outcomes = await Promise.allSettled([1, 2].map(() => service().forgetStudent({
    adminUserId: ADMIN_USER_ID,
    userId: student.id,
    expectedEmail: student.mail
  })));

  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.equal(rejected.reason.code, ACCOUNT_FORGETTING_ERRORS.accountAnonymized);
  const runs = await query(
    'SELECT count(*)::int AS runs FROM student_anonymization_events WHERE user_id = $1',
    [student.id]
  );
  assert.equal(runs[0].runs, 1);
});

test('V29: user_erasure_requests keeps codes, statuses and service ids well formed', {
  skip: SKIP_REASON
}, async () => {
  const userId = (await insertUser()).id;
  const insert = (columns, values) => query(
    `INSERT INTO user_erasure_requests (user_id, service_id${columns}) VALUES ($1, $2${values})`,
    [userId, `svc-${randomUUID().slice(0, 8)}`]
  );

  await insert('', '');
  await assert.rejects(insert(', status', ", 'retrying'"), { code: '23514' });
  await assert.rejects(insert(', last_error', ", 'connect ECONNREFUSED 10.0.0.1'"), { code: '23514' });
  await assert.rejects(insert(', status', ", 'done'"), { code: '23514' }, 'done needs completed_at');
  await assert.rejects(insert(', completed_at', ', NOW()'), { code: '23514' }, 'only done has completed_at');
  await assert.rejects(insert(', attempts', ', -1'), { code: '23514' });
  await assert.rejects(
    query("INSERT INTO user_erasure_requests (user_id, service_id) VALUES ($1, 'Polyadic Agent')", [userId]),
    { code: '23514' }
  );
  await query("INSERT INTO user_erasure_requests (user_id, service_id) VALUES ($1, 'polyadic-agent')", [userId]);
  await assert.rejects(
    query("INSERT INTO user_erasure_requests (user_id, service_id) VALUES ($1, 'polyadic-agent')", [userId]),
    { code: '23505' }
  );
});

// With the planner's sequential scans switched off, each statement the
// per-account step filters by user must find an index on that user column.
// Without one, PostgreSQL would still scan the table.
test('V29: the anonymization statements use the user indexes (EXPLAIN)', {
  skip: SKIP_REASON
}, async () => {
  const statements = [
    ['UPDATE differential_selection SET comment = $1 WHERE uid = $2 AND comment IS NOT NULL', 'idx_differential_selection_uid'],
    ['UPDATE differential_chat SET content = $1 WHERE uid = $2 AND content IS NOT NULL', 'idx_differential_chat_uid'],
    ['UPDATE chat SET content = $1 WHERE uid = $2 AND content IS NOT NULL', 'idx_chat_uid'],
    ['UPDATE actor_selection SET description = $1 WHERE uid = $2 AND description IS NOT NULL', 'idx_actor_selection_uid'],
    [
      'SELECT id, raw_payload, sanitized_payload, adapter_result FROM external_service_results WHERE user_id = $2 AND $1::text IS NOT NULL FOR UPDATE',
      'idx_external_service_results_user_id'
    ],
    [
      'SELECT id, outbound_payload FROM external_service_jobs WHERE user_id = $2 AND outbound_payload IS NOT NULL AND $1::text IS NOT NULL FOR UPDATE',
      'idx_external_service_jobs_user_id'
    ]
  ];

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    // A generic plan, as for any user id the step is called with.
    await client.query("SET LOCAL plan_cache_mode = 'force_generic_plan'");

    for (const [sql, indexName] of statements) {
      const name = `explain_${indexName}`;
      await client.query(`PREPARE ${name} (text, integer) AS ${sql}`);
      const plan = (await client.query(`EXPLAIN EXECUTE ${name}('${PLACEHOLDER}', 1)`))
        .rows.map((row) => row['QUERY PLAN']).join('\n');
      assert.match(plan, new RegExp(`Index (Only )?Scan using ${indexName}|Bitmap Index Scan on ${indexName}`), plan);
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('V29: editing an anonymized account is refused', { skip: SKIP_REASON }, async () => {
  const account = await insertUser({ anonymized: true });
  const email = `it-876-${randomUUID()}@example.com`;

  await assert.rejects(updateUserById(account.id, {
    firstname: 'Real',
    lastname: 'Name',
    sex: 'F',
    email,
    email_confirmation: email,
    role: 'A',
    active: true
  }, { queryFn: (sql, params) => getPool().query(sql, params) }), { message: 'ACCOUNT_ANONYMIZED' });

  const [user] = await query('SELECT firstname, active FROM users WHERE id = $1', [account.id]);
  assert.deepEqual(user, { firstname: 'Ana', active: true });
});
