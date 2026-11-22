// Integration tests for the redaction of stored mediation decisions when a
// participant is forgotten (#1222, ethicapp V46), against a real PostgreSQL
// database with migrations V1-V46 applied.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The tests insert accounts, teams, chat messages,
// AI service rows, anonymization runs and audit events, and never remove them.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';

import { createAccountForgettingService } from '../../services/account-forgetting.service.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

const ADMIN_USER_ID = 1;
const P = '******';
const SERVICE_ID = 'polyadic-devils-advocate';
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

async function insertUser(firstname, lastname) {
  const [row] = await query(
    `
      INSERT INTO users (name, firstname, lastname, mail, role, active, email_confirmed, password_bcrypt)
      VALUES ($1, $2, $3, $4, 'A', true, true, 'bcrypt-hash')
      RETURNING id, mail
    `,
    [`${firstname} ${lastname}`, firstname, lastname, `it-1222-${randomUUID()}@example.com`]
  );
  return row;
}

async function insertTeam() {
  const [team] = await query('INSERT INTO teams DEFAULT VALUES RETURNING id');
  return team.id;
}

// A room-level callback carrying one decision, and its stored record; with
// a topic coverage (#1233, V47) and its resolved evidence when given.
async function insertDecision(groupId, reason, { topicCoverage, coverageEvidence } = {}) {
  const decisionId = randomUUID();
  const record = {
    schemaVersion: 'mediation-decision/v1',
    decisionId,
    agent: 'Validator',
    pipelineType: 'contentCoverage',
    decidedAt: '2026-11-18T14:07:20-03:00',
    trigger: { kind: 'adaptive_window', reason: 'max_wait' },
    window: { messages: [{ messageId: 115, correlationId: null }] },
    decision: 'no_intervention',
    category: null,
    topic: null,
    reason,
    intervention: { status: 'not_requested', agent: null, messageId: null, suppressedBy: null },
    ...(topicCoverage ? { topicCoverage } : {})
  };
  const [result] = await query(
    `
      INSERT INTO external_service_results (service_id, status, group_id, raw_payload)
      VALUES ($1, 'completed', $2, $3::jsonb)
      RETURNING id
    `,
    [SERVICE_ID, groupId, JSON.stringify({ room: 'ethicapp-s1-p2-g3', evaluations: [], decisions: [record] })]
  );
  await query(
    `
      INSERT INTO external_service_mediation_decisions
        (service_id, decision_id, session_id, phase_id, group_id, result_id, decided_at, record,
         coverage_evidence_chat_message_ids)
      VALUES ($1, $2, 1, 2, $3, $4, $5, $6::jsonb, $7::jsonb)
    `,
    [
      SERVICE_ID, decisionId, groupId, result.id, record.decidedAt, JSON.stringify(record),
      coverageEvidence ? JSON.stringify(coverageEvidence) : null
    ]
  );
  return { decisionId, resultId: result.id };
}

async function storedReasons({ decisionId, resultId }) {
  const [decision] = await query(
    'SELECT record ->> \'reason\' AS reason FROM external_service_mediation_decisions WHERE decision_id = $1',
    [decisionId]
  );
  const [result] = await query(
    'SELECT raw_payload -> \'decisions\' -> 0 ->> \'reason\' AS reason FROM external_service_results WHERE id = $1',
    [resultId]
  );
  return { decision: decision.reason, payload: result.reason };
}

test('forgetting a student redacts the decisions of the groups they wrote in, in the record and the callback', {
  skip: SKIP_REASON
}, async () => {
  const student = await insertUser('Valentina', 'Rojas');
  const classmate = await insertUser('Tomás', 'Díaz');
  const team = await insertTeam();
  const otherTeam = await insertTeam();
  const message = 'Creo que firmar el registro sin revisarlo pone en riesgo a los pacientes.';
  await query('INSERT INTO differential_chat (uid, tmid, content) VALUES ($1, $2, $3), ($4, $2, $5)', [
    student.id, team, message, classmate.id, 'Yo no estoy seguro.'
  ]);

  const quoting = await insertDecision(team,
    'Valentina dice que firmar el registro sin revisarlo pone en riesgo; Tomás duda.');
  const unrelated = await insertDecision(team, 'Hay menos de 3 mensajes de menos de 2 participantes.');
  const elsewhere = await insertDecision(otherTeam, 'Valentina no participa aquí.');

  const result = await createAccountForgettingService({ pool: getPool(), env: {}, logger: silentLogger })
    .forgetStudent({ adminUserId: ADMIN_USER_ID, userId: student.id, expectedEmail: student.mail });
  assert.equal(result.status, 'anonymized');

  const expected = `${P} dice ${P}; Tomás duda.`;
  assert.deepEqual(await storedReasons(quoting), { decision: expected, payload: expected });
  const unchanged = 'Hay menos de 3 mensajes de menos de 2 participantes.';
  assert.deepEqual(await storedReasons(unrelated), { decision: unchanged, payload: unchanged });
  // A group the student never wrote in is not searched.
  assert.deepEqual(await storedReasons(elsewhere),
    { decision: 'Valentina no participa aquí.', payload: 'Valentina no participa aquí.' });

  // The student's own message is replaced afterwards, as before.
  const [own] = await query('SELECT content FROM differential_chat WHERE uid = $1', [student.id]);
  assert.equal(own.content, P);

  const [event] = await query(
    'SELECT message FROM student_anonymization_events WHERE user_id = $1 AND status = \'succeeded\'',
    [student.id]
  );
  assert.match(event.message, /mediation decision reasons redacted: 1\./);
  assert.match(event.message, /mediation decision payloads redacted: 1\./);
});

test('forgetting a student redacts the reason of a decision with a topic coverage and leaves the coverage', {
  skip: SKIP_REASON
}, async () => {
  const student = await insertUser('Ignacia', 'Fuentes');
  const team = await insertTeam();
  await query('INSERT INTO differential_chat (uid, tmid, content) VALUES ($1, $2, $3)', [
    student.id, team, 'La supervisora no puede pedirnos firmar algo que no revisamos.'
  ]);
  const topicCoverage = {
    status: 'unchanged',
    updatedTopicIds: [],
    topics: [
      { id: 'T1', status: 'partial', evidence: [{ messageId: 115, correlationId: null }] },
      { id: 'T2', status: 'pending', evidence: [] }
    ]
  };
  const coverageEvidence = [[null], []];
  const decision = await insertDecision(team, 'Ignacia habla de la supervisora.',
    { topicCoverage, coverageEvidence });

  const result = await createAccountForgettingService({ pool: getPool(), env: {}, logger: silentLogger })
    .forgetStudent({ adminUserId: ADMIN_USER_ID, userId: student.id, expectedEmail: student.mail });
  assert.equal(result.status, 'anonymized');

  const expected = `${P} habla de la supervisora.`;
  assert.deepEqual(await storedReasons(decision), { decision: expected, payload: expected });
  // The coverage holds ids only: the erasure leaves it and its evidence as stored.
  const [row] = await query(
    `SELECT record -> 'topicCoverage' AS coverage, coverage_evidence_chat_message_ids AS evidence
     FROM external_service_mediation_decisions WHERE decision_id = $1`,
    [decision.decisionId]
  );
  assert.deepEqual(row, { coverage: topicCoverage, evidence: coverageEvidence });
  const [payload] = await query(
    'SELECT raw_payload -> \'decisions\' -> 0 -> \'topicCoverage\' AS coverage FROM external_service_results WHERE id = $1',
    [decision.resultId]
  );
  assert.deepEqual(payload.coverage, topicCoverage);
});
