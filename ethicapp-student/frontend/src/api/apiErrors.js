// Classifies failed API calls so the UI can tell an expired session, an outage
// and an application refusal apart. The NGINX edge answers API calls with
// 401 {"status":"expired"} and {"status":"unavailable"} for its own failures,
// and sends X-Request-Id on every response.

export const API_ERROR_KINDS = Object.freeze({
  EXPIRED: 'expired',
  FORBIDDEN: 'forbidden',
  UNAVAILABLE: 'unavailable',
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  APPLICATION: 'application'
});

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);
const GATEWAY_STATUSES = new Set([502, 503, 504]);
const OUTAGE_KINDS = new Set([API_ERROR_KINDS.UNAVAILABLE, API_ERROR_KINDS.NETWORK, API_ERROR_KINDS.TIMEOUT]);

function readHeader(headers, name) {
  if (!headers) {
    return undefined;
  }

  if (typeof headers.get === 'function') {
    return headers.get(name) ?? undefined;
  }

  return headers[name] ?? headers[name.toLowerCase()];
}

/**
 * True when a response carries an HTML document, which an API call only
 * receives when something in front of the API answered with a page.
 */
export function isHtmlResponse(response) {
  return /\btext\/html\b/i.test(String(readHeader(response?.headers, 'content-type') ?? ''));
}

export function getRequestId(response) {
  const requestId = readHeader(response?.headers, 'x-request-id');
  return typeof requestId === 'string' && requestId ? requestId : null;
}

/**
 * @param {unknown} error Rejection of an Axios call, or any other error.
 * @returns {{ kind: string, status: number|null, requestId: string|null, response: object|null }}
 */
export function classifyApiError(error) {
  // Errors thrown before any request (validation, programming errors) and
  // cancellations are left to the caller.
  if (error?.isAxiosError !== true || error.code === 'ERR_CANCELED') {
    return { kind: API_ERROR_KINDS.APPLICATION, status: null, requestId: null, response: null };
  }

  const { response } = error;

  if (!response) {
    const kind = TIMEOUT_CODES.has(error.code) ? API_ERROR_KINDS.TIMEOUT : API_ERROR_KINDS.NETWORK;
    return { kind, status: null, requestId: null, response: null };
  }

  const { status } = response;
  const bodyStatus = response.data?.status;
  let kind = API_ERROR_KINDS.APPLICATION;

  if (status === 401 || bodyStatus === 'expired' || (status < 300 && isHtmlResponse(response))) {
    kind = API_ERROR_KINDS.EXPIRED;
  } else if (status === 403) {
    kind = API_ERROR_KINDS.FORBIDDEN;
  } else if (bodyStatus === 'unavailable' || GATEWAY_STATUSES.has(status)) {
    kind = API_ERROR_KINDS.UNAVAILABLE;
  }

  return { kind, status, requestId: getRequestId(response), response };
}

export function isOutage(kind) {
  return OUTAGE_KINDS.has(kind);
}

/**
 * Message for a failed call: expired sessions and outages get the shared
 * wording (with the request id when there is one); anything else keeps the
 * caller's own message.
 * @param {unknown} error
 * @param {(key: string, params?: object) => string} t
 * @param {{ fallbackKey: string, bodyField?: string }} options `bodyField` names
 *   the response body field that carries the application's own message.
 */
export function describeApiError(error, t, { fallbackKey, bodyField = 'error' }) {
  const { kind, requestId } = classifyApiError(error);

  if (kind === API_ERROR_KINDS.EXPIRED) {
    return t('apiErrors.sessionExpired');
  }

  if (isOutage(kind)) {
    return withReference(t('apiErrors.unavailable'), requestId, t);
  }

  const applicationMessage = error?.response?.data?.[bodyField];
  return typeof applicationMessage === 'string' && applicationMessage ? applicationMessage : t(fallbackKey);
}

export function withReference(message, requestId, t) {
  return requestId ? `${message} ${t('apiErrors.reference', { requestId })}` : message;
}
