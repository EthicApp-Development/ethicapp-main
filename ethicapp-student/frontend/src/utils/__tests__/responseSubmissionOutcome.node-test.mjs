import assert from 'node:assert/strict';
import test from 'node:test';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  RESPONSE_REFUSAL_CODES,
  RESPONSE_REFUSAL_MESSAGE_KEYS,
  describeResponseSubmissionError
} from '../responseSubmissionOutcome.js';
import { createTranslator } from '../../i18n/translator.js';

function httpError(status, data, headers = { 'content-type': 'application/json' }) {
  const response = { status, data, headers: new AxiosHeaders(headers), config: {} };
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', {}, {}, response);
}

function t(key, params = {}) {
  return params.requestId ? `${key}:${params.requestId}` : key;
}

const REFUSALS = [
  [404, 'SESSION_NOT_FOUND', 'sessionDetail.responseRefusals.sessionNotFound', false],
  [409, 'ACTIVITY_FINISHED', 'sessionDetail.responseRefusals.activityFinished', true],
  [409, 'NO_ACTIVE_PHASE', 'sessionDetail.responseRefusals.noActivePhase', true],
  [409, 'PHASE_CHANGED', 'sessionDetail.responseRefusals.phaseChanged', true],
  [400, 'UNSUPPORTED_DESIGN_TYPE', 'sessionDetail.responseRefusals.unsupportedDesignType', false],
  [400, 'QUESTION_NOT_IN_PHASE', 'sessionDetail.responseRefusals.questionNotInPhase', false]
];

test('each refusal code maps to its own message', () => {
  for (const [status, code, messageKey, reload] of REFUSALS) {
    const outcome = describeResponseSubmissionError(httpError(status, { error: 'English text', code }), t);

    assert.deepEqual(outcome, { code, message: messageKey, reload }, code);
  }
  assert.deepEqual(Object.keys(RESPONSE_REFUSAL_CODES).sort(), REFUSALS.map(([, code]) => code).sort());
});

test('only refusals that leave the activity out of date ask for a reload', () => {
  const reloading = REFUSALS.filter(([, , , reload]) => reload).map(([, code]) => code);

  assert.deepEqual(reloading, ['ACTIVITY_FINISHED', 'NO_ACTIVE_PHASE', 'PHASE_CHANGED']);
});

test('an error without a known code keeps the generic message', () => {
  const validation = httpError(400, { error: 'Justification is required for this item.' });
  const unknownCode = httpError(409, { error: 'Other', code: 'SOMETHING_ELSE' });
  const forbidden = httpError(403, { error: 'Forbidden' });

  for (const error of [validation, unknownCode, forbidden, new Error('boom')]) {
    assert.deepEqual(describeResponseSubmissionError(error, t), {
      code: null,
      message: 'sessionDetail.responseSubmitError',
      reload: false
    });
  }
});

test('an expired session and an outage get the shared wording', () => {
  assert.equal(
    describeResponseSubmissionError(httpError(401, { status: 'expired' }), t).message,
    'apiErrors.sessionExpired'
  );
  assert.equal(
    describeResponseSubmissionError(
      httpError(502, { status: 'unavailable' }, { 'content-type': 'application/json', 'x-request-id': 'req-9' }),
      t
    ).message,
    'apiErrors.unavailable apiErrors.reference:req-9'
  );
});

test('every refusal message is translated in es_CL and en_US', () => {
  for (const locale of ['es_CL', 'en_US']) {
    const translate = createTranslator(locale);
    const messages = Object.values(RESPONSE_REFUSAL_MESSAGE_KEYS).map((key) => translate(key));

    for (const [index, key] of Object.values(RESPONSE_REFUSAL_MESSAGE_KEYS).entries()) {
      assert.notEqual(messages[index], key, `${locale} ${key}`);
    }
    assert.equal(new Set(messages).size, messages.length, `${locale} messages are distinct`);
  }

  const spanish = createTranslator('es_CL');
  const english = createTranslator('en_US');
  for (const key of Object.values(RESPONSE_REFUSAL_MESSAGE_KEYS)) {
    assert.notEqual(spanish(key), english(key), key);
  }
});
