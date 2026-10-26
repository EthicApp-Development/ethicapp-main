import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError, AxiosHeaders } from 'axios';
import { API_ERROR_KINDS, classifyApiError, describeApiError, withReference } from '../apiErrors.js';

function httpError(status, data, headers = {}) {
  const response = { status, data, headers: new AxiosHeaders(headers), config: {} };
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', {}, {}, response);
}

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };

function t(key, params = {}) {
  return params.requestId ? `${key}:${params.requestId}` : key;
}

test('the edge expiry answer and any 401 are an expired session', () => {
  assert.equal(classifyApiError(httpError(401, { status: 'expired' }, JSON_TYPE)).kind, API_ERROR_KINDS.EXPIRED);
  assert.equal(classifyApiError(httpError(401, { error: 'Unauthorized' }, JSON_TYPE)).kind, API_ERROR_KINDS.EXPIRED);
});

test('a successful response with an HTML page is an expired session', () => {
  const error = httpError(200, '<!doctype html><title>Sign in</title>', { 'content-type': 'text/html' });
  assert.equal(classifyApiError(error).kind, API_ERROR_KINDS.EXPIRED);
});

test('an HTML error page from a proxy is an outage, not an expired session', () => {
  const error = httpError(502, '<html>Bad Gateway</html>', { 'content-type': 'text/html' });
  assert.equal(classifyApiError(error).kind, API_ERROR_KINDS.UNAVAILABLE);
});

test('edge and gateway failures are an outage and carry the request id', () => {
  const edge = classifyApiError(httpError(500, { status: 'unavailable' }, { ...JSON_TYPE, 'x-request-id': 'req-1' }));
  assert.deepEqual([edge.kind, edge.status, edge.requestId], [API_ERROR_KINDS.UNAVAILABLE, 500, 'req-1']);

  for (const status of [502, 503, 504]) {
    assert.equal(classifyApiError(httpError(status, {}, JSON_TYPE)).kind, API_ERROR_KINDS.UNAVAILABLE);
  }
});

test('403 is forbidden; other refusals and application 500s are left to the caller', () => {
  assert.equal(classifyApiError(httpError(403, { error: 'Forbidden' }, JSON_TYPE)).kind, API_ERROR_KINDS.FORBIDDEN);

  for (const status of [400, 404, 409, 500]) {
    const classification = classifyApiError(httpError(status, { status: 'code_not_found' }, JSON_TYPE));
    assert.equal(classification.kind, API_ERROR_KINDS.APPLICATION, `status ${status}`);
    assert.equal(classification.response.status, status);
  }
});

test('requests without a response are network errors or timeouts', () => {
  assert.equal(classifyApiError(new AxiosError('Network Error', 'ERR_NETWORK', {}, {})).kind, API_ERROR_KINDS.NETWORK);
  assert.equal(classifyApiError(new AxiosError('timeout', 'ECONNABORTED', {}, {})).kind, API_ERROR_KINDS.TIMEOUT);
  assert.equal(classifyApiError(new AxiosError('timeout', 'ETIMEDOUT', {}, {})).kind, API_ERROR_KINDS.TIMEOUT);
});

test('non-HTTP errors and cancellations are application errors', () => {
  assert.equal(classifyApiError(new Error('Invalid sessionId')).kind, API_ERROR_KINDS.APPLICATION);
  assert.equal(classifyApiError(new AxiosError('canceled', 'ERR_CANCELED', {}, {})).kind, API_ERROR_KINDS.APPLICATION);
  assert.equal(classifyApiError(undefined).kind, API_ERROR_KINDS.APPLICATION);
});

test('describeApiError uses the shared wording for expiry and outages', () => {
  const options = { fallbackKey: 'sessions.loadErrorFallback' };

  assert.equal(describeApiError(httpError(401, { status: 'expired' }, JSON_TYPE), t, options), 'apiErrors.sessionExpired');
  assert.equal(
    describeApiError(httpError(502, { status: 'unavailable' }, { ...JSON_TYPE, 'x-request-id': 'req-2' }), t, options),
    'apiErrors.unavailable apiErrors.reference:req-2'
  );
  assert.equal(describeApiError(new AxiosError('Network Error', 'ERR_NETWORK', {}, {}), t, options), 'apiErrors.unavailable');
});

test('describeApiError keeps the application message or the caller fallback', () => {
  const options = { fallbackKey: 'sessions.loadErrorFallback' };

  assert.equal(describeApiError(httpError(404, { error: 'Session not found' }, JSON_TYPE), t, options), 'Session not found');
  assert.equal(describeApiError(httpError(404, { error: { nested: true } }, JSON_TYPE), t, options), 'sessions.loadErrorFallback');
  assert.equal(describeApiError(new Error('boom'), t, options), 'sessions.loadErrorFallback');
  assert.equal(
    describeApiError(httpError(404, { message: 'Case not found' }, JSON_TYPE), t, { ...options, bodyField: 'message' }),
    'Case not found'
  );
});

test('withReference appends the request id only when there is one', () => {
  assert.equal(withReference('Unavailable.', 'req-3', t), 'Unavailable. apiErrors.reference:req-3');
  assert.equal(withReference('Unavailable.', null, t), 'Unavailable.');
});
