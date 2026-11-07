// Integration tests for the redaction of AI service payloads when a student is
// forgotten (#1155), against a real PostgreSQL database with migrations V1 to
// V44 or later applied. The database's redact_jsonb_strings (V31, V44) and
// the console's redactJsonStrings must give the same JSON for the same input,
// and the V31 trigger must keep Polyadic's agent names while it replaces every
// other string of a forgotten student's callback result.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The test inserts users and callback results, and
// does not remove them.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

import { redactJsonStrings } from '../student-ai-service-data-helper.js';

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
  ? false
  : 'ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.';

if (SKIP_REASON) {
  console.warn(SKIP_REASON);
}

const PLACEHOLDER = '******';

// A Polyadic reactive callback as stored, and its handler's result.
const POLYADIC_RAW = Object.freeze({
  room: 'ethicapp-s11-p22-g301',
  evaluations: [
    { agente: 'ConversationGuide', respuesta: 'Ana, what do you think?', display_name: 'Profe Ana' },
    { agente: 'Validator', respuesta: 'NO_INTERVENIR: Ana is answering', display_name: 'Validator' }
  ]
});
const POLYADIC_ADAPTER_RESULT = Object.freeze({
  hook: 'callback-received',
  status: 'completed',
  payload: {
    room: 'ethicapp-s11-p22-g301',
    messagesPublished: 1,
    publishedMessages: [{ messageId: 7, agentName: 'ConversationGuide', displayName: 'Profe Ana', evaluationIndex: 0 }]
  }
});

const PARITY_CASES = Object.freeze({
  polyadicRaw: POLYADIC_RAW,
  polyadicAdapterResult: POLYADIC_ADAPTER_RESULT,
  tutorCallback: {
    eventId: 'b2c3d4e5-0000-4000-8000-000000000001',
    payload: {
      argumentPreview: 'Creo que la farmacéutica debería bajar el precio.',
      criteria: [{ name: 'claim', value: 'Clear claim.', score: 1 }],
      userId: 42,
      complete: true,
      note: null,
      empty: ''
    }
  },
  agentKeysWithoutStrings: { agente: { name: 'Ana' }, agentName: ['Ana', 3], nested: { agente: 'Validator' } },
  emptyObject: {},
  emptyArray: [],
  plainString: 'text'
});

describe('redaction of AI service payloads', { skip: SKIP_REASON }, () => {
  let pool = null;
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

  before(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  });

  after(async () => {
    await pool?.end();
  });

  it('gives the same JSON in the database and in the console', async () => {
    for (const [name, value] of Object.entries(PARITY_CASES)) {
      const [row] = await query('SELECT redact_jsonb_strings($1::jsonb, $2) AS redacted;', [
        JSON.stringify(value),
        PLACEHOLDER
      ]);
      assert.deepEqual(row.redacted, redactJsonStrings(value, PLACEHOLDER), name);
    }
  });

  it('keeps the agent names of a forgotten student\'s Polyadic result and replaces the rest', async () => {
    const [user] = await query(`
      INSERT INTO users (name, mail, role)
      VALUES ('Forgotten student', $1, 'A')
      RETURNING id;
    `, [`${randomUUID()}@integration.test`]);
    await query('UPDATE users SET anonymized_at = now() WHERE id = $1;', [user.id]);

    // Stored after the forgetting: the insert trigger redacts it; the
    // handler's update is redacted by the update trigger.
    const [result] = await query(`
      INSERT INTO external_service_results (service_id, user_id, raw_payload)
      VALUES ('polyadic-devils-advocate', $1, $2::jsonb)
      RETURNING id;
    `, [user.id, JSON.stringify(POLYADIC_RAW)]);
    await query(
      'UPDATE external_service_results SET adapter_result = $2::jsonb WHERE id = $1;',
      [result.id, JSON.stringify(POLYADIC_ADAPTER_RESULT)]
    );

    const [stored] = await query(
      'SELECT raw_payload, adapter_result FROM external_service_results WHERE id = $1;',
      [result.id]
    );
    assert.deepEqual(stored.raw_payload, {
      room: PLACEHOLDER,
      evaluations: [
        { agente: 'ConversationGuide', respuesta: PLACEHOLDER, display_name: PLACEHOLDER },
        { agente: 'Validator', respuesta: PLACEHOLDER, display_name: PLACEHOLDER }
      ]
    });
    assert.deepEqual(stored.adapter_result, {
      hook: PLACEHOLDER,
      status: PLACEHOLDER,
      payload: {
        room: PLACEHOLDER,
        messagesPublished: 1,
        publishedMessages: [
          { messageId: 7, agentName: 'ConversationGuide', displayName: PLACEHOLDER, evaluationIndex: 0 }
        ]
      }
    });
  });
});
