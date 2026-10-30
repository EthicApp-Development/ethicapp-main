import { ACCOUNT_STATUSES, accountActionErrorKey } from './accountStatus.js';
import { formatAccountDate } from './accountDates.js';

// Whether the console offers to delete an account: it is pending (never
// confirmed nor activated) and its owner never signed in. The backend
// checks the same definition, and that nothing references the account.
export function isDeletableAccount({ status, lastLoginAt }) {
  return status === ACCOUNT_STATUSES.pending && !lastLoginAt;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// How long ago an account was created, in the console locale ("3 days ago",
// "hace 3 días"). Returns null for a missing or invalid date.
export function formatAccountAge(createdAt, locale, now = Date.now()) {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;

  if (Number.isNaN(created)) {
    return null;
  }

  const elapsed = Math.max(now - created, 0);
  const formatter = new Intl.RelativeTimeFormat(String(locale).replace('_', '-'), { numeric: 'always' });

  if (elapsed < HOUR) {
    return formatter.format(-Math.max(Math.floor(elapsed / MINUTE), 1), 'minute');
  }
  if (elapsed < DAY) {
    return formatter.format(-Math.floor(elapsed / HOUR), 'hour');
  }
  if (elapsed < 60 * DAY) {
    return formatter.format(-Math.floor(elapsed / DAY), 'day');
  }
  if (elapsed < 730 * DAY) {
    return formatter.format(-Math.floor(elapsed / (30 * DAY)), 'month');
  }
  return formatter.format(-Math.floor(elapsed / (365 * DAY)), 'year');
}

// The sentence of the deletion dialog about how long the account has been
// pending; accounts created before users.created_at existed have no date.
export function accountAgeDetails(createdAt, locale, t, now = Date.now()) {
  const age = formatAccountAge(createdAt, locale, now);

  if (!age) {
    return t('pages.userShow.deleteAccount.createdUnknown');
  }

  return t('pages.userShow.deleteAccount.createdAgo', {
    age,
    date: formatAccountDate(createdAt, locale, { withTime: true })
  });
}

const DELETION_ERROR_KEYS = Object.freeze({
  ACCOUNT_NOT_DELETABLE: 'pages.userShow.deleteAccount.errors.accountNotDeletable',
  ACCOUNT_CHANGED: 'pages.userShow.deleteAccount.errors.accountChanged'
});

// Translated message of a failed deletion, or null for an error the console
// has no translation for.
export function accountDeletionErrorMessage(error, t) {
  const code = error?.code ?? error?.message;

  if (code === 'ACCOUNT_REFERENCED') {
    const categoryKey = `pages.userShow.deleteAccount.referenceCategories.${error.body?.reference_category}`;
    const data = t(categoryKey);

    return t('pages.userShow.deleteAccount.errors.accountReferenced', {
      data: data === categoryKey ? t('pages.userShow.deleteAccount.referenceCategories.accountData') : data,
      table: error.body?.referenced_by || '?'
    });
  }

  const key = DELETION_ERROR_KEYS[code] || accountActionErrorKey(error);
  return key ? t(key) : null;
}
