// Account lifecycle statuses as the backend reports them (`status` of a user,
// management-console/backend/services/account-status.js), and how the
// console presents them.

export const ACCOUNT_STATUSES = Object.freeze({
  active: 'active',
  pending: 'pending',
  inactive: 'inactive',
  anonymized: 'anonymized'
});

// Statuses the users list filters by, in the order of the filter options.
export const ACCOUNT_STATUS_FILTERS = Object.freeze([
  ACCOUNT_STATUSES.pending,
  ACCOUNT_STATUSES.active,
  ACCOUNT_STATUSES.inactive
]);

const BADGE_VARIANTS = Object.freeze({
  [ACCOUNT_STATUSES.active]: 'success',
  [ACCOUNT_STATUSES.pending]: 'warning',
  [ACCOUNT_STATUSES.inactive]: 'secondary',
  [ACCOUNT_STATUSES.anonymized]: 'dark'
});

// Status of a user as returned by the API. A response without `status`
// (an older backend) falls back to the flags it derives from.
export function accountStatusOf(user) {
  if (BADGE_VARIANTS[user?.status]) {
    return user.status;
  }
  if (user?.active === false) {
    return user.emailConfirmed === false ? ACCOUNT_STATUSES.pending : ACCOUNT_STATUSES.inactive;
  }
  return ACCOUNT_STATUSES.active;
}

export function accountStatusBadgeVariant(status) {
  return BADGE_VARIANTS[status] || 'secondary';
}

// Backend error codes of the account actions, mapped to translations.
const ACCOUNT_ACTION_ERROR_KEYS = Object.freeze({
  ACCOUNT_NOT_PENDING: 'pages.userShow.errors.accountNotPending',
  USER_NOT_FOUND: 'pages.userShow.errors.userNotFound',
  INVALID_USER_ID: 'pages.userShow.errors.invalidUserId'
});

// Translation key for a failed account action, or null for an error the
// console has no translation for.
export function accountActionErrorKey(error) {
  return ACCOUNT_ACTION_ERROR_KEYS[error?.code ?? error?.message] ?? null;
}
