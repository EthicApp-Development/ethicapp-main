import assert from 'node:assert/strict';
import test from 'node:test';

import {
  USER_ERASURE_SERVICE_IDS,
  eraseExternalServicePayloads,
  recordUserErasureRequests,
  redactJsonStrings
} from '../student-ai-service-data-helper.js';

function createFakeClient({ results = [], jobs = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      if (text.startsWith('SELECT id, raw_payload')) {
        return { rows: results, rowCount: results.length };
      }
      if (text.startsWith('SELECT id, outbound_payload')) {
        return { rows: jobs, rowCount: jobs.length };
      }
      return { rows: [], rowCount: 1 };
    }
  };
}

// A tutor callback as it is stored: the argument preview and the tutor's
// feedback quote the student.
const TUTOR_CALLBACK = Object.freeze({
  eventId: 'b2c3d4e5-0000-4000-8000-000000000001',
  payload: {
    argumentPreview: 'Creo que la farmacéutica debería bajar el precio.',
    comparison: { initialArgument: 'Primera versión', revisedArgument: 'Segunda versión' },
    criteria: [{ name: 'claim', value: 'Clear claim about the price.', score: 1 }],
    userId: 42,
    scores: { claim: 1, evidence: 0 },
    complete: true,
    note: null
  }
});

test('redactJsonStrings replaces every string at any depth and keeps the rest', () => {
  assert.deepEqual(redactJsonStrings(TUTOR_CALLBACK, '******'), {
    eventId: '******',
    payload: {
      argumentPreview: '******',
      comparison: { initialArgument: '******', revisedArgument: '******' },
      criteria: [{ name: '******', value: '******', score: 1 }],
      userId: 42,
      scores: { claim: 1, evidence: 0 },
      complete: true,
      note: null
    }
  });
  assert.equal(redactJsonStrings('', '******'), '');
  assert.equal(redactJsonStrings(null, '******'), null);
  assert.equal(redactJsonStrings('text', '******'), '******');
});

test('eraseExternalServicePayloads rewrites the payloads of the user\'s results and jobs that change', async () => {
  const client = createFakeClient({
    results: [
      {
        id: 'result-1',
        raw_payload: TUTOR_CALLBACK,
        sanitized_payload: null,
        adapter_result: { status: 'completed', payload: { claimTypeRationale: 'She will be fired.' } }
      },
      // Already erased: nothing to write.
      { id: 'result-2', raw_payload: { count: 3 }, sanitized_payload: null, adapter_result: null }
    ],
    jobs: [{ id: 'job-1', outbound_payload: { argument: 'Texto del estudiante' } }]
  });

  const counts = await eraseExternalServicePayloads(client, 42, '******');

  assert.deepEqual(counts, { results: 1, jobs: 1 });
  const [selectResults, updateResult, selectJobs, updateJob] = client.calls;
  assert.match(selectResults.sql, /FROM external_service_results WHERE user_id = \$1 FOR UPDATE/);
  assert.deepEqual(selectResults.params, [42]);
  assert.match(updateResult.sql, /^UPDATE external_service_results SET raw_payload = \$2::jsonb/);
  assert.equal(updateResult.params[0], 'result-1');
  assert.equal(updateResult.params[1].includes('farmacéutica'), false);
  assert.equal(updateResult.params[2], null);
  assert.deepEqual(JSON.parse(updateResult.params[3]), {
    status: '******',
    payload: { claimTypeRationale: '******' }
  });
  assert.match(selectJobs.sql, /FROM external_service_jobs WHERE user_id = \$1 AND outbound_payload IS NOT NULL/);
  assert.deepEqual(updateJob.params, ['job-1', JSON.stringify({ argument: '******' })]);
  assert.equal(client.calls.length, 4);
});

test('recordUserErasureRequests records a pending request per AI Additions service, resetting earlier ones', async () => {
  const client = createFakeClient();

  const serviceIds = await recordUserErasureRequests(client, 42, 77);

  assert.deepEqual(serviceIds, ['argumentation-tutor', 'polyadic-agent']);
  assert.deepEqual(USER_ERASURE_SERVICE_IDS, serviceIds);
  const [insert] = client.calls;
  assert.match(insert.sql, /^INSERT INTO user_erasure_requests \(user_id, service_id, anonymization_run_id\)/);
  assert.match(insert.sql, /ON CONFLICT \(user_id, service_id\) DO UPDATE SET status = 'pending', attempts = 0/);
  assert.deepEqual(insert.params, [42, ['argumentation-tutor', 'polyadic-agent'], 77]);
});
