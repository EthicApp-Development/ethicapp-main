// Sort orders of the user list by creation date, as the backend accepts them
// in its `sort` parameter. The backend falls back to newest first.
export const CREATED_AT_SORTS = Object.freeze({
  newestFirst: 'created_at_desc',
  oldestFirst: 'created_at_asc'
});

export function toggleCreatedAtSort(sort) {
  return sort === CREATED_AT_SORTS.oldestFirst
    ? CREATED_AT_SORTS.newestFirst
    : CREATED_AT_SORTS.oldestFirst;
}

// Formats an account date with the console locale (es_CL or en_US). Returns
// null for a missing or invalid value, so the caller shows its own label:
// accounts created before users.created_at existed have no creation date.
export function formatAccountDate(value, locale, { withTime = false } = {}) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(String(locale).replace('_', '-'), {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {})
  }).format(date);
}
