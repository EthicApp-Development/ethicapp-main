// Lifecycle status of an account, derived from the users columns:
// - anonymized: anonymized_at is set; the account no longer names anyone;
// - pending: the owner signed up and never confirmed the email
//   (active = false AND email_confirmed = false);
// - inactive: deactivated by an administrator after its email was confirmed;
// - active: any other account. Legacy rows may hold NULL in active, which
//   the schema defaults to true.
export const ACCOUNT_STATUSES = Object.freeze({
  active: 'active',
  pending: 'pending',
  inactive: 'inactive',
  anonymized: 'anonymized'
});

export function deriveAccountStatus({ active, emailConfirmed, anonymizedAt = null }) {
  if (anonymizedAt) {
    return ACCOUNT_STATUSES.anonymized;
  }

  if (active === false && emailConfirmed === false) {
    return ACCOUNT_STATUSES.pending;
  }

  if (active === false) {
    return ACCOUNT_STATUSES.inactive;
  }

  return ACCOUNT_STATUSES.active;
}

// SQL condition for each status the users list filters by. Anonymized
// accounts are excluded from the list altogether.
export const ACCOUNT_STATUS_FILTER_SQL = Object.freeze({
  [ACCOUNT_STATUSES.active]: 'active IS NOT FALSE',
  [ACCOUNT_STATUSES.pending]: 'active = false AND email_confirmed = false',
  [ACCOUNT_STATUSES.inactive]: 'active = false AND email_confirmed IS NOT FALSE'
});
