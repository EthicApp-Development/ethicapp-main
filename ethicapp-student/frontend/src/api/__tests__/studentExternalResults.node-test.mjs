import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStudentExternalResults } from '../studentExternalResults.js';

function fakeClient(data) {
  const calls = [];
  return {
    calls,
    async get(...args) {
      calls.push(args);
      return { data };
    }
  };
}

test('reads the student results route of the session and the student', async () => {
  const results = [{ resultId: '1', phaseId: 20 }];
  const client = fakeClient({ results });

  const answer = await fetchStudentExternalResults(client, { sessionId: 3, userId: '7' });

  assert.deepEqual(answer, results);
  assert.deepEqual(client.calls, [['/activities/3/users/7/external_service_results']]);
});

test('an answer without a results list reads as no results', async () => {
  const ids = { sessionId: 3, userId: 7 };

  assert.deepEqual(await fetchStudentExternalResults(fakeClient({}), ids), []);
  assert.deepEqual(await fetchStudentExternalResults(fakeClient(null), ids), []);
});

test('ids that are not positive integers are refused before any request', async () => {
  const client = fakeClient({ results: [] });

  const invalid = [{ sessionId: 0, userId: 7 }, { sessionId: 3, userId: 'x' }];

  for (const ids of invalid) {
    await assert.rejects(fetchStudentExternalResults(client, ids), TypeError);
  }
  await assert.rejects(fetchStudentExternalResults(client), TypeError);
  assert.equal(client.calls.length, 0);
});

test('a failed request rejects with the client error', async () => {
  const error = new Error('Request failed with status code 404');
  const client = { get: async () => { throw error; } };

  await assert.rejects(fetchStudentExternalResults(client, { sessionId: 3, userId: 7 }), error);
});
