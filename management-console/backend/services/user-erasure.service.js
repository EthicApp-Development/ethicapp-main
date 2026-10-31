import { buildUrl, fetchInternalJson, internalIdentityHeaders } from './ethicapp.service.js';

// The background erasure of a forgotten account: its AI Additions erasure
// requests (#876) and the deletion of its files (#877), read and retried
// through ethicapp's internal endpoints
// (`/api/admin/user-erasure/users/:id[/retry]`), which only ethicapp serves:
// it holds the AI Additions credentials and processes the requests. The
// console forwards the operator's cookie and identity headers, as for the AI
// services page.
//
// Results are values, never thrown: { ok: true, requests, uploadDeletions }
// or { ok: false, error } with one of USER_ERASURE_ERROR_CODES.

export const USER_ERASURE_ERROR_CODES = Object.freeze([
  // ethicapp could not be reached (it may be stopped or restarting).
  'unreachable',
  // ethicapp answered with an error status.
  'ethicapp_error',
  // ethicapp answered 200 with a body of another shape.
  'invalid_response'
]);

export const ERASURE_REQUEST_STATUSES = Object.freeze(['pending', 'done', 'failed']);

const STATUS_TIMEOUT_MS = 10000;
// A retry attempts the requests before answering: up to two AI Additions
// calls, each bounded by ethicapp's AI_ADDITIONS_HTTP_TIMEOUT_MS, and the
// file deletions, which are local to ethicapp.
const RETRY_TIMEOUT_MS = 45000;
const SERVICE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function timestampOrNull(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function sanitizeRequest(request) {
  if (
    !request ||
    typeof request.serviceId !== 'string' ||
    !SERVICE_ID_PATTERN.test(request.serviceId) ||
    !ERASURE_REQUEST_STATUSES.includes(request.status) ||
    !Number.isInteger(request.attempts) ||
    request.attempts < 0
  ) {
    return null;
  }

  return {
    serviceId: request.serviceId,
    status: request.status,
    attempts: request.attempts,
    lastError: typeof request.lastError === 'string' && ERROR_CODE_PATTERN.test(request.lastError)
      ? request.lastError
      : null,
    nextAttemptAt: timestampOrNull(request.nextAttemptAt),
    lastAttemptAt: timestampOrNull(request.lastAttemptAt),
    requestedAt: timestampOrNull(request.requestedAt),
    completedAt: timestampOrNull(request.completedAt)
  };
}

// Counters of the file deletions ethicapp reports, by status. `retrying`
// counts the pending ones that already failed at least once.
export const UPLOAD_DELETION_COUNTERS = Object.freeze(['total', 'pending', 'retrying', 'done', 'skipped', 'failed']);

const EMPTY_UPLOAD_DELETIONS = Object.freeze({
  total: 0,
  pending: 0,
  retrying: 0,
  done: 0,
  skipped: 0,
  failed: 0,
  lastError: null
});

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

// The summary of the account's file deletions, keeping only the documented
// fields; an empty one when ethicapp sent none, or null when malformed.
export function sanitizeUploadDeletions(summary) {
  if (summary === undefined || summary === null) {
    return { ...EMPTY_UPLOAD_DELETIONS };
  }

  if (typeof summary !== 'object' || !UPLOAD_DELETION_COUNTERS.every((key) => isCount(summary[key]))) {
    return null;
  }

  const sanitized = Object.fromEntries(UPLOAD_DELETION_COUNTERS.map((key) => [key, summary[key]]));
  sanitized.lastError = typeof summary.lastError === 'string' && ERROR_CODE_PATTERN.test(summary.lastError)
    ? summary.lastError
    : null;
  return sanitized;
}

// The documented body, keeping only the documented fields, or null.
export function sanitizeErasureRequestsBody(body) {
  if (!body || body.ok !== true || !Array.isArray(body.requests)) {
    return null;
  }

  const requests = body.requests.map(sanitizeRequest);
  const uploadDeletions = sanitizeUploadDeletions(body.uploadDeletions);
  if (requests.some((request) => request === null) || !uploadDeletions) {
    return null;
  }

  return { requests, uploadDeletions };
}

async function exchangeWithEthicapp(pathname, method, identity, { fetchImpl, timeoutMs }) {
  const exchange = await fetchInternalJson(
    buildUrl(pathname),
    { method, headers: internalIdentityHeaders(identity) },
    { fetchImpl, timeoutMs }
  );

  if (exchange.transportError) {
    return { ok: false, error: 'unreachable' };
  }

  if (!exchange.ok) {
    return { ok: false, error: 'ethicapp_error' };
  }

  const sanitized = sanitizeErasureRequestsBody(exchange.body);
  return sanitized ? { ok: true, ...sanitized } : { ok: false, error: 'invalid_response' };
}

export async function fetchUserErasureRequestsFromEthicapp({
  targetUserId,
  cookie,
  userId,
  userRole,
  language,
  fetchImpl = fetch,
  timeoutMs = STATUS_TIMEOUT_MS
}) {
  return exchangeWithEthicapp(
    `/api/admin/user-erasure/users/${Number(targetUserId)}`,
    'GET',
    { cookie, userId, userRole, language },
    { fetchImpl, timeoutMs }
  );
}

export async function retryUserErasureRequestsInEthicapp({
  targetUserId,
  cookie,
  userId,
  userRole,
  language,
  fetchImpl = fetch,
  timeoutMs = RETRY_TIMEOUT_MS
}) {
  return exchangeWithEthicapp(
    `/api/admin/user-erasure/users/${Number(targetUserId)}/retry`,
    'POST',
    { cookie, userId, userRole, language },
    { fetchImpl, timeoutMs }
  );
}
