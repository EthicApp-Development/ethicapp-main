import { describe, expect, it } from 'vitest';

import translations from '../../../i18n/translations.js';
import {
  accountAgeDetails,
  accountDeletionErrorMessage,
  formatAccountAge,
  isDeletableAccount
} from '../accountDeletion.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function translatorFor(locale) {
  return (key, params = {}) => {
    const value = key.split('.').reduce((node, part) => node?.[part], translations[locale]);
    if (typeof value !== 'string') {
      return key;
    }
    return Object.entries(params).reduce(
      (text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)),
      value
    );
  };
}

describe('isDeletableAccount', () => {
  it('offers the deletion only for a pending account whose owner never signed in', () => {
    expect(isDeletableAccount({ status: 'pending', lastLoginAt: null })).toBe(true);
    expect(isDeletableAccount({ status: 'pending', lastLoginAt: '2026-10-01T10:00:00Z' })).toBe(false);
    for (const status of ['active', 'inactive', 'anonymized']) {
      expect(isDeletableAccount({ status, lastLoginAt: null })).toBe(false);
    }
  });
});

describe('formatAccountAge', () => {
  it('uses the largest fitting unit, in the console locale', () => {
    const ago = (elapsed) => new Date(NOW - elapsed).toISOString();

    expect(formatAccountAge(ago(10 * 1000), 'en_US', NOW)).toBe('1 minute ago');
    expect(formatAccountAge(ago(42 * MINUTE), 'en_US', NOW)).toBe('42 minutes ago');
    expect(formatAccountAge(ago(5 * HOUR), 'en_US', NOW)).toBe('5 hours ago');
    expect(formatAccountAge(ago(3 * DAY), 'en_US', NOW)).toBe('3 days ago');
    expect(formatAccountAge(ago(90 * DAY), 'en_US', NOW)).toBe('3 months ago');
    expect(formatAccountAge(ago(800 * DAY), 'en_US', NOW)).toBe('2 years ago');
    expect(formatAccountAge(ago(3 * DAY), 'es_CL', NOW)).toBe('hace 3 días');
  });

  it('answers null for a missing or invalid date', () => {
    expect(formatAccountAge(null, 'en_US', NOW)).toBeNull();
    expect(formatAccountAge('not a date', 'en_US', NOW)).toBeNull();
  });
});

describe('accountAgeDetails', () => {
  it('states the age and the date, or that it is unknown, in both locales', () => {
    const createdAt = new Date(NOW - 3 * DAY).toISOString();

    expect(accountAgeDetails(createdAt, 'en_US', translatorFor('en_US'), NOW))
      .toMatch(/^The account was created 3 days ago \(.+\) and was never activated\.$/);
    expect(accountAgeDetails(createdAt, 'es_CL', translatorFor('es_CL'), NOW))
      .toMatch(/^La cuenta se creó hace 3 días \(.+\) y nunca se activó\.$/);
    expect(accountAgeDetails(null, 'es_CL', translatorFor('es_CL'), NOW))
      .toBe('No se sabe cuánto tiempo lleva pendiente la cuenta: se creó antes de que se registraran las fechas de creación.');
  });
});

describe('accountDeletionErrorMessage', () => {
  const t = translatorFor('en_US');

  it('names the kind of data and the table of a referenced account', () => {
    const error = {
      code: 'ACCOUNT_REFERENCED',
      body: { referenced_by: 'external_service_jobs', reference_category: 'aiServices' }
    };

    expect(accountDeletionErrorMessage(error, t))
      .toBe('This account has AI service jobs or results (table external_service_jobs), so it was not deleted.');
    expect(accountDeletionErrorMessage(error, translatorFor('es_CL')))
      .toBe('Esta cuenta tiene trabajos o resultados de servicios de IA (tabla external_service_jobs), así que no se eliminó.');
  });

  it('translates the other refusals, and answers null for an unknown error', () => {
    expect(accountDeletionErrorMessage({ code: 'ACCOUNT_NOT_DELETABLE' }, t))
      .toContain('Only accounts that were never activated can be deleted');
    expect(accountDeletionErrorMessage({ code: 'ACCOUNT_CHANGED' }, t)).toContain('so it was not deleted');
    expect(accountDeletionErrorMessage({ code: 'USER_NOT_FOUND' }, t)).toBe('This account no longer exists.');
    expect(accountDeletionErrorMessage({ code: 'Request failed' }, t)).toBeNull();
  });

  it('has a translation for every reference category in both locales', () => {
    for (const locale of ['en_US', 'es_CL']) {
      const categories = translations[locale].pages.userShow.deleteAccount.referenceCategories;
      expect(Object.keys(categories).sort()).toEqual([
        'accountData',
        'activities',
        'administration',
        'aiServices',
        'authoredContent',
        'responses',
        'teams'
      ]);
    }
  });
});
