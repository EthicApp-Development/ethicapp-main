import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretJoinError, interpretJoinResponse } from '../joinSessionOutcome.js';

test('joined and already_joined responses carry the session id', () => {
  assert.deepEqual(interpretJoinResponse({ data: { status: 'joined', sesid: 57 } }), {
    kind: 'joined',
    sessionId: 57,
    messageKey: 'joinSession.joinedSuccess',
    succeeded: true
  });

  const alreadyJoined = interpretJoinResponse({ data: { status: 'already_joined', sesid: 57 } });
  assert.equal(alreadyJoined.kind, 'already_joined');
  assert.equal(alreadyJoined.messageKey, 'joinSession.alreadyJoined');
  assert.equal(alreadyJoined.succeeded, true);
});

test('unexpected success bodies are treated as failures', () => {
  assert.equal(interpretJoinResponse({ data: '<!doctype html>' }).kind, 'failed');
  assert.equal(interpretJoinResponse({ data: { status: 'joined' } }).kind, 'failed');
  assert.equal(interpretJoinResponse({ data: { status: 'ok', sesid: 57 } }).kind, 'failed');
});

test('each refusal maps to its own message', () => {
  const kinds = ['code_not_found', 'joining_closed', 'invalid_request'].map((status) =>
    interpretJoinError({ response: { status: 400, data: { status } } }));

  assert.deepEqual(kinds.map(({ messageKey }) => messageKey), [
    'joinSession.codeNotFound',
    'joinSession.joiningClosed',
    'joinSession.invalidCode'
  ]);
  assert.ok(kinds.every(({ succeeded }) => !succeeded));
});

test('network errors, auth errors and unknown bodies fall back to the generic message', () => {
  for (const error of [
    new Error('Network Error'),
    { response: { status: 401, data: { error: 'User not authenticated' } } },
    { response: { status: 500, data: '<html>' } }
  ]) {
    assert.equal(interpretJoinError(error).messageKey, 'joinSession.joinErrorFallback');
  }
});
