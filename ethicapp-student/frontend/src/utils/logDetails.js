/**
 * What the student app writes to the browser console about server data
 * (#1139): ids, names and statuses. Socket payloads, response bodies, results
 * and request errors can quote students (their answers, shared responses, AI
 * feedback), so they are never logged whole.
 */

const PAYLOAD_ID_KEYS = ['resultId', 'serviceId', 'phaseId', 'questionId'];
const MAX_ID_LENGTH = 100;
const ID_PATTERN = /^[\w.:-]+$/;

function positiveIdOrNull(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function idOrNull(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value)) {
    return value;
  }

  return null;
}

/**
 * The details of a socket event worth logging: the session, and the ids the
 * payload names (`resultId`, `serviceId`, `phaseId`, `questionId`).
 * @param {number|string} sessionId
 * @param {unknown} [payload]
 * @returns {Record<string, number|string|null>}
 */
export function socketEventLogDetails(sessionId, payload) {
  const details = { sessionId: positiveIdOrNull(sessionId) };

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return details;
  }

  PAYLOAD_ID_KEYS.forEach((key) => {
    const id = idOrNull(payload[key]);
    if (id !== null) {
      details[key] = id;
    }
  });

  return details;
}

/**
 * The details of an error worth logging: its name, its code and, for an HTTP
 * error, the response status. The message, the request and the response body
 * are left out.
 * @param {unknown} error
 * @returns {{ name: string|null, code: string|null, status: number|null }}
 */
export function errorLogDetails(error) {
  const status = Number(error?.response?.status);

  return {
    name: typeof error?.name === 'string' ? error.name : null,
    code: typeof error?.code === 'string' ? error.code : null,
    status: Number.isInteger(status) ? status : null
  };
}
