// How the console presents the AI Additions erasure requests of a forgotten
// account (#876). The backend reports `pending`, `done` or `failed`; a pending
// request that already failed at least once is being retried.

export const ERASURE_DISPLAY_STATUSES = Object.freeze({
  done: 'done',
  pending: 'pending',
  retrying: 'retrying',
  failed: 'failed'
});

export function erasureDisplayStatus(request) {
  if (request?.status === 'done') {
    return ERASURE_DISPLAY_STATUSES.done;
  }
  if (request?.status === 'failed') {
    return ERASURE_DISPLAY_STATUSES.failed;
  }
  return request?.attempts > 0 ? ERASURE_DISPLAY_STATUSES.retrying : ERASURE_DISPLAY_STATUSES.pending;
}

// Whether an administrator's retry can change anything.
export function canRetryErasure(requests) {
  return Array.isArray(requests) && requests.some((request) => request.status !== 'done');
}

// Backend error codes of forgetting a student, mapped to translations. Codes
// shared with the other account actions use their messages.
const FORGET_ERROR_KEYS = Object.freeze({
  ACCOUNT_ANONYMIZED: 'pages.userForget.errors.accountAnonymized',
  NOT_A_STUDENT: 'pages.userForget.errors.notAStudent',
  ACCOUNT_CHANGED: 'pages.userForget.errors.accountChanged',
  USER_NOT_FOUND: 'pages.userShow.errors.userNotFound',
  INVALID_USER_ID: 'pages.userShow.errors.invalidUserId'
});

export function forgetErrorKey(error) {
  return FORGET_ERROR_KEYS[error?.code ?? error?.message] ?? null;
}
