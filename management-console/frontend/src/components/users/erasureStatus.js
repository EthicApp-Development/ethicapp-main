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

// How the console presents the deletion of the files a forgotten account
// freed (#877), from ethicapp's summary { total, pending, retrying, done,
// skipped, failed }: the worst status of any file, or null when the account
// has none. A file kept because another row uses it counts as done.
export function uploadDeletionDisplayStatus(summary) {
  if (!summary || !(summary.total > 0)) {
    return null;
  }
  if (summary.failed > 0) {
    return ERASURE_DISPLAY_STATUSES.failed;
  }
  if (summary.retrying > 0) {
    return ERASURE_DISPLAY_STATUSES.retrying;
  }
  if (summary.pending > 0) {
    return ERASURE_DISPLAY_STATUSES.pending;
  }
  return ERASURE_DISPLAY_STATUSES.done;
}

// Whether an administrator's retry can change anything: a request or a file
// deletion is not complete.
export function canRetryErasure(requests, uploadDeletions = null) {
  const requestPending = Array.isArray(requests) && requests.some((request) => request.status !== 'done');
  const filesPending = uploadDeletionDisplayStatus(uploadDeletions) !== null &&
    uploadDeletionDisplayStatus(uploadDeletions) !== ERASURE_DISPLAY_STATUSES.done;
  return requestPending || filesPending;
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

// Backend error codes of forgetting a teacher (#877), mapped to
// translations, and whether the account or the recipient changed, so the
// page reloads the account.
const FORGET_TEACHER_ERRORS = Object.freeze({
  ACCOUNT_ANONYMIZED: { key: 'pages.userForgetTeacher.errors.accountAnonymized', changed: true },
  NOT_A_TEACHER: { key: 'pages.userForgetTeacher.errors.notATeacher', changed: true },
  ACCOUNT_CHANGED: { key: 'pages.userForgetTeacher.errors.accountChanged', changed: true },
  INVALID_RECIPIENT: { key: 'pages.userForgetTeacher.errors.recipientUnavailable', changed: false },
  RECIPIENT_UNAVAILABLE: { key: 'pages.userForgetTeacher.errors.recipientUnavailable', changed: false },
  RECIPIENT_CHANGED: { key: 'pages.userForgetTeacher.errors.recipientChanged', changed: false },
  OPEN_ACTIVITIES: { key: 'pages.userForgetTeacher.errors.openActivities', changed: false },
  ACTIVITIES_NOT_FINISHED: { key: 'pages.userForgetTeacher.errors.activitiesNotFinished', changed: false },
  USER_NOT_FOUND: { key: 'pages.userShow.errors.userNotFound', changed: true },
  INVALID_USER_ID: { key: 'pages.userShow.errors.invalidUserId', changed: false }
});

// { key, changed } for a refusal of forgetting a teacher, or null for any
// other error.
export function forgetTeacherError(error) {
  return FORGET_TEACHER_ERRORS[error?.code ?? error?.message] ?? null;
}
