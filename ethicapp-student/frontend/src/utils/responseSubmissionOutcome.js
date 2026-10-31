import { API_ERROR_KINDS, classifyApiError, isOutage, withReference } from '../api/apiErrors.js';

// Maps refusals of POST /activities/:id/response (legacy ethicapp, #927) to
// localized messages. The backend answers each refusal with a stable `code`.

export const RESPONSE_REFUSAL_CODES = Object.freeze({
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  ACTIVITY_FINISHED: 'ACTIVITY_FINISHED',
  NO_ACTIVE_PHASE: 'NO_ACTIVE_PHASE',
  PHASE_CHANGED: 'PHASE_CHANGED',
  UNSUPPORTED_DESIGN_TYPE: 'UNSUPPORTED_DESIGN_TYPE',
  QUESTION_NOT_IN_PHASE: 'QUESTION_NOT_IN_PHASE'
});

export const RESPONSE_REFUSAL_MESSAGE_KEYS = Object.freeze({
  [RESPONSE_REFUSAL_CODES.SESSION_NOT_FOUND]: 'sessionDetail.responseRefusals.sessionNotFound',
  [RESPONSE_REFUSAL_CODES.ACTIVITY_FINISHED]: 'sessionDetail.responseRefusals.activityFinished',
  [RESPONSE_REFUSAL_CODES.NO_ACTIVE_PHASE]: 'sessionDetail.responseRefusals.noActivePhase',
  [RESPONSE_REFUSAL_CODES.PHASE_CHANGED]: 'sessionDetail.responseRefusals.phaseChanged',
  [RESPONSE_REFUSAL_CODES.UNSUPPORTED_DESIGN_TYPE]: 'sessionDetail.responseRefusals.unsupportedDesignType',
  [RESPONSE_REFUSAL_CODES.QUESTION_NOT_IN_PHASE]: 'sessionDetail.responseRefusals.questionNotInPhase'
});

// After these refusals the activity the student sees is out of date: it moved
// to another phase, or ended.
const STALE_STATE_CODES = new Set([
  RESPONSE_REFUSAL_CODES.ACTIVITY_FINISHED,
  RESPONSE_REFUSAL_CODES.NO_ACTIVE_PHASE,
  RESPONSE_REFUSAL_CODES.PHASE_CHANGED
]);

/**
 * @param {unknown} error Rejection of the submission call.
 * @param {(key: string, params?: object) => string} t
 * @returns {{ code: string|null, message: string, reload: boolean }} `reload` is
 *   true when the activity state should be loaded again.
 */
export function describeResponseSubmissionError(error, t) {
  const code = error?.response?.data?.code;

  if (typeof code === 'string' && Object.hasOwn(RESPONSE_REFUSAL_MESSAGE_KEYS, code)) {
    return { code, message: t(RESPONSE_REFUSAL_MESSAGE_KEYS[code]), reload: STALE_STATE_CODES.has(code) };
  }

  const { kind, requestId } = classifyApiError(error);

  if (kind === API_ERROR_KINDS.EXPIRED) {
    return { code: null, message: t('apiErrors.sessionExpired'), reload: false };
  }

  if (isOutage(kind)) {
    return { code: null, message: withReference(t('apiErrors.unavailable'), requestId, t), reload: false };
  }

  return { code: null, message: t('sessionDetail.responseSubmitError'), reload: false };
}
