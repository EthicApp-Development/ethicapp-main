import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError, AxiosHeaders } from 'axios';
import { interpretJoinError, interpretJoinResponse } from '../joinSessionOutcome.js';

test('joined and already_joined responses carry the session id', () => {
  assert.deepEqual(interpretJoinResponse({ data: { status: 'joined', sesid: 57 } }), {
    kind: 'joined',
    sessionId: 57,
    requestId: null,
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

function httpError(status, data, headers = { 'content-type': 'application/json' }) {
  const response = { status, data, headers: new AxiosHeaders(headers), config: {} };
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', {}, {}, response);
}

test('an expired session gets its own message instead of the generic one', () => {
  for (const error of [
    httpError(401, { status: 'expired' }),
    httpError(200, '<!doctype html>', { 'content-type': 'text/html' })
  ]) {
    const result = interpretJoinError(error);
    assert.equal(result.kind, 'session_expired');
    assert.equal(result.messageKey, 'apiErrors.sessionExpired');
    assert.equal(result.succeeded, false);
  }
});

test('outages get the unavailable message with the request id when there is one', () => {
  const outage = interpretJoinError(httpError(502, { status: 'unavailable' }, { 'x-request-id': 'req-1' }));
  assert.deepEqual([outage.kind, outage.messageKey, outage.requestId], ['unavailable', 'apiErrors.unavailable', 'req-1']);

  const network = interpretJoinError(new AxiosError('Network Error', 'ERR_NETWORK', {}, {}));
  assert.deepEqual([network.kind, network.requestId], ['unavailable', null]);
});

test('other failures fall back to the generic message', () => {
  for (const error of [
    new Error('Unexpected'),
    httpError(403, { error: 'Forbidden' }),
    httpError(500, { error: 'Internal error' })
  ]) {
    assert.equal(interpretJoinError(error).messageKey, 'joinSession.joinErrorFallback');
  }
});
