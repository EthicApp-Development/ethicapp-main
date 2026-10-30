import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import CreatedAtSortHeader from '../CreatedAtSortHeader.jsx';
import { CREATED_AT_SORTS, formatAccountDate, toggleCreatedAtSort } from '../accountDates.js';

const noop = () => {};

describe('formatAccountDate', () => {
  const value = '2026-10-29T15:30:00.000Z';

  it('formats a date with the console locale', () => {
    expect(formatAccountDate(value, 'en_US')).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value))
    );
    expect(formatAccountDate(value, 'es_CL')).toBe(
      new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(value))
    );
  });

  it('adds the time when asked', () => {
    expect(formatAccountDate(value, 'es_CL', { withTime: true })).toBe(
      new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    );
  });

  it('returns null for an unknown or invalid date', () => {
    expect(formatAccountDate(null, 'en_US')).toBeNull();
    expect(formatAccountDate('', 'en_US')).toBeNull();
    expect(formatAccountDate('not a date', 'en_US')).toBeNull();
  });
});

describe('creation-date sort', () => {
  it('toggles between newest and oldest first', () => {
    expect(toggleCreatedAtSort(CREATED_AT_SORTS.newestFirst)).toBe(CREATED_AT_SORTS.oldestFirst);
    expect(toggleCreatedAtSort(CREATED_AT_SORTS.oldestFirst)).toBe(CREATED_AT_SORTS.newestFirst);
    expect(toggleCreatedAtSort('unknown')).toBe(CREATED_AT_SORTS.oldestFirst);
  });

  // Without an I18n provider, t() returns the translation key.
  it('renders the header with the current order and the next one', () => {
    const newest = renderToStaticMarkup(
      <table><thead><tr>
        <CreatedAtSortHeader sort={CREATED_AT_SORTS.newestFirst} onSortChange={noop} />
      </tr></thead></table>
    );
    expect(newest).toContain('aria-sort="descending"');
    expect(newest).toContain('data-testid="users-sort-created-at"');
    expect(newest).toContain('pages.users.sort.oldestFirst');

    const oldest = renderToStaticMarkup(
      <table><thead><tr>
        <CreatedAtSortHeader sort={CREATED_AT_SORTS.oldestFirst} onSortChange={noop} />
      </tr></thead></table>
    );
    expect(oldest).toContain('aria-sort="ascending"');
    expect(oldest).toContain('pages.users.sort.newestFirst');
  });

  it('has its labels in both locales', () => {
    for (const locale of [enUS, esCL]) {
      const { users, userShow } = locale.pages;
      expect(users.columns.createdAt).toBeTruthy();
      expect(users.createdAtUnknown).toBeTruthy();
      expect(users.sort.newestFirst).toBeTruthy();
      expect(users.sort.oldestFirst).toBeTruthy();
      expect(userShow.fields.createdAt).toBeTruthy();
      expect(userShow.status.createdAtUnknown).toBeTruthy();
    }
  });
});
