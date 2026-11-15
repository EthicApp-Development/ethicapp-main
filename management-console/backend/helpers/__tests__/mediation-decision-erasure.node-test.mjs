import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_QUOTED_FRAGMENT_WORDS,
  quotedFragmentSpans,
  redactMediationDecisionReasons,
  redactText,
  redactionTerms
} from '../mediation-decision-erasure.js';

const P = '******';

// The cases below are Polyadic's own (ethicapp-ai-additions
// polyadic-agents/backend/tests/test_participant_data.py), so both sides
// redact a participant the same way.
const QUOTE = 'I think the pharmacist should lower the price.';
const ANA_LIVE = 'ERASEME302956 Creo que la farmacéutica debería bajar el precio del '
  + 'medicamento porque la vida vale más que la ganancia.';
const LUIS_LIVE = "KEEPME… Estoy de acuerdo con Ana: 'ERASEME302956 Creo que la "
  + "farmacéutica debería bajar el prec' y además el Estado debería ayudar.";

test('terms cover the name, its agent form and its words, longest first', () => {
  const terms = redactionTerms(['María José'], []);
  assert.deepEqual(new Set(terms.names), new Set(['María José', 'María_José', 'María', 'José']));
  assert.ok(['María José', 'María_José'].includes(terms.names[0]));
  assert.deepEqual(terms.sources, []);
});

test('terms skip one-letter masks, short words and short messages', () => {
  const terms = redactionTerms(['A', null, 'Li Bo', 'user-42'], ['sí, de acuerdo', QUOTE]);
  assert.equal(terms.names.includes('A'), false);
  assert.equal(terms.names.includes('Bo') || terms.names.includes('Li'), false);
  for (const name of ['Li Bo', 'Li_Bo', 'user-42']) {
    assert.ok(terms.names.includes(name), name);
  }
  assert.deepEqual(terms.sources, [['i', 'think', 'the', 'pharmacist', 'should', 'lower', 'the', 'price']]);
});

test('without terms the text is left alone', () => {
  const terms = redactionTerms(['A'], ['sí']);
  assert.equal(redactText('A said sí', terms, P), 'A said sí');
  assert.equal(redactText(null, redactionTerms(['Ana'], [QUOTE]), P), null);
  assert.equal(redactText('', redactionTerms(['Ana'], [QUOTE]), P), '');
});

test('names are replaced as whole words only, case-sensitively', () => {
  const text = 'Ana said it. @Ana, the Analyst agrees; ana and Banana stay.';
  assert.equal(redactText(text, redactionTerms(['Ana'], []), P),
    `${P} said it. @${P}, the Analyst agrees; ana and Banana stay.`);
});

test('the longest name wins and whole quotes are removed', () => {
  const terms = redactionTerms(['María José'], [QUOTE]);
  const text = `María José wrote "${QUOTE}" and María_José agreed. José too.`;
  assert.equal(redactText(text, terms, P),
    `${P} wrote "${P}." and ${P} agreed. ${P} too.`);
});

test('a quote cut mid-word at either end is redacted', () => {
  assert.equal(redactText(LUIS_LIVE, redactionTerms(['Ana'], [ANA_LIVE]), P),
    `KEEPME… Estoy de acuerdo con ${P}: '${P}' y además el Estado debería ayudar.`);

  const text = 'Como dijo: «éutica debería bajar el precio del medicamento porque» no sé.';
  assert.equal(redactText(text, redactionTerms([], [ANA_LIVE]), P), `Como dijo: «${P}» no sé.`);
});

test('fragments match ignoring case, spacing and punctuation', () => {
  const text = 'Ella escribió:\n  LA VIDA,  vale   más que la GANANCIA!! y tiene razón.';
  assert.equal(redactText(text, redactionTerms([], [ANA_LIVE]), P),
    `Ella escribió:\n  ${P}!! y tiene razón.`);
});

test('runs shorter than a fragment are kept, two fragments are both redacted', () => {
  assert.equal(MIN_QUOTED_FRAGMENT_WORDS, 6);
  const terms = redactionTerms([], [ANA_LIVE]);
  const fiveWords = 'Yo también creo que la farmacéutica debería ayudar.';
  assert.equal(redactText(fiveWords, terms, P), fiveWords);

  const text = 'Primero: creo que la farmacéutica debería bajar. Luego: '
    + 'porque la vida vale más que la ganancia. Fin.';
  assert.equal(redactText(text, terms, P), `Primero: ${P}. Luego: ${P}. Fin.`);
});

test('overlapping spans merge', () => {
  const terms = redactionTerms([], [
    'uno dos tres cuatro cinco seis siete ocho',
    'cuatro cinco seis siete ocho nueve diez once'
  ]);
  const text = 'x uno dos tres cuatro cinco seis siete ocho nueve diez once y';
  assert.deepEqual(quotedFragmentSpans(text, terms.sources), [[2, text.length - 2]]);
  assert.equal(redactText(text, terms, P), `x ${P} y`);
});

// ─── The step's database work ───────────────────────────────────────────────

const DECISION_A = 'b1a2c3d4-0000-4000-8000-000000000001';
const DECISION_B = 'b1a2c3d4-0000-4000-8000-000000000002';
const RESULT_ID = 'c0ffee00-0000-4000-8000-000000000001';

function createFakeClient({
  messages = [],
  decisions = [],
  identity = { firstname: 'Ana', lastname: 'Pérez', name: 'Ana Pérez' },
  results = []
} = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      if (text.startsWith('SELECT tmid AS group_id, content FROM differential_chat')) {
        return { rows: messages };
      }
      if (text.startsWith('SELECT id, group_id, result_id')) {
        return { rows: decisions };
      }
      if (text.startsWith('SELECT firstname, lastname, name FROM users')) {
        return { rows: [identity] };
      }
      if (text.startsWith('SELECT id, raw_payload FROM external_service_results')) {
        return { rows: results };
      }
      return { rows: [], rowCount: 1 };
    }
  };
}

const ANA_MESSAGE = 'Creo que firmar el registro sin revisarlo pone en riesgo a los pacientes.';

test('reasons in the groups the user wrote in lose the user\'s names and quotes', async () => {
  const quoting = 'Ana dice que firmar el registro sin revisarlo pone en riesgo; Beto no responde.';
  const unrelated = 'El grupo repite que firmar está mal sin agregar argumentos nuevos.';
  const client = createFakeClient({
    messages: [{ group_id: 301, content: ANA_MESSAGE }],
    decisions: [
      { id: '1', group_id: 301, result_id: RESULT_ID, decision_id: DECISION_A, reason: quoting },
      { id: '2', group_id: 301, result_id: RESULT_ID, decision_id: DECISION_B, reason: unrelated }
    ],
    results: [{
      id: RESULT_ID,
      raw_payload: {
        room: 'ethicapp-s11-p22-g301',
        evaluations: [],
        decisions: [
          { decisionId: DECISION_A, reason: quoting, decision: 'no_intervention' },
          { decisionId: DECISION_B, reason: unrelated, decision: 'no_intervention' }
        ]
      }
    }]
  });

  const counts = await redactMediationDecisionReasons(client, 41, P);

  assert.deepEqual(counts, { decisions: 1, results: 1 });
  // "que firmar ... en riesgo" is eight consecutive words of her message.
  const expected = `${P} dice ${P}; Beto no responde.`;

  const decisionUpdates = client.calls.filter(call => call.sql.startsWith('UPDATE external_service_mediation_decisions'));
  assert.deepEqual(decisionUpdates.map(call => call.params), [['1', expected]]);
  assert.match(decisionUpdates[0].sql, /jsonb_set\(record, '\{reason\}', to_jsonb\(\$2::text\)\)/);

  const resultUpdates = client.calls.filter(call => call.sql.startsWith('UPDATE external_service_results'));
  assert.equal(resultUpdates.length, 1);
  assert.equal(resultUpdates[0].params[0], RESULT_ID);
  assert.deepEqual(JSON.parse(resultUpdates[0].params[1]), {
    room: 'ethicapp-s11-p22-g301',
    evaluations: [],
    decisions: [
      { decisionId: DECISION_A, reason: expected, decision: 'no_intervention' },
      { decisionId: DECISION_B, reason: unrelated, decision: 'no_intervention' }
    ]
  });

  // Only the groups the user wrote in, from both chat tables.
  const messagesQuery = client.calls[0];
  assert.match(messagesQuery.sql, /FROM differential_chat .* UNION ALL .* FROM chat/);
  assert.deepEqual(messagesQuery.params, [41]);
  const decisionsQuery = client.calls.find(call => call.sql.startsWith('SELECT id, group_id, result_id'));
  assert.deepEqual(decisionsQuery.params, [[301]]);
  assert.match(decisionsQuery.sql, /FOR UPDATE$/);
});

test('a decision without a stored callback is redacted on its own', async () => {
  const client = createFakeClient({
    identity: { firstname: 'Beatriz', lastname: 'Soto', name: null },
    messages: [{ group_id: 302, content: 'sí' }],
    decisions: [{ id: '3', group_id: 302, result_id: null, decision_id: DECISION_A, reason: 'Beatriz no ha opinado.' }]
  });

  const counts = await redactMediationDecisionReasons(client, 41, P);

  assert.deepEqual(counts, { decisions: 1, results: 0 });
  assert.equal(client.calls.some(call => call.sql.startsWith('SELECT id, raw_payload')), false);
  const update = client.calls.find(call => call.sql.startsWith('UPDATE external_service_mediation_decisions'));
  assert.deepEqual(update.params, ['3', `${P} no ha opinado.`]);
});

test('a user who wrote in no group, or whose groups have no decisions, changes nothing', async () => {
  const silent = createFakeClient();
  assert.deepEqual(await redactMediationDecisionReasons(silent, 41, P), { decisions: 0, results: 0 });
  assert.equal(silent.calls.length, 1);

  const noDecisions = createFakeClient({ messages: [{ group_id: 301, content: ANA_MESSAGE }] });
  assert.deepEqual(await redactMediationDecisionReasons(noDecisions, 41, P), { decisions: 0, results: 0 });
  assert.equal(noDecisions.calls.some(call => call.sql.startsWith('UPDATE')), false);
});

test('a reason with nothing of the user is not written', async () => {
  const client = createFakeClient({
    messages: [{ group_id: 301, content: ANA_MESSAGE }],
    decisions: [{ id: '1', group_id: 301, result_id: RESULT_ID, decision_id: DECISION_A, reason: 'Hay menos de 3 mensajes.' }]
  });

  assert.deepEqual(await redactMediationDecisionReasons(client, 41, P), { decisions: 0, results: 0 });
  assert.equal(client.calls.some(call => call.sql.startsWith('UPDATE')), false);
});
