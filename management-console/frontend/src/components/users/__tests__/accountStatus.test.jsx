import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import enUS from '../../../i18n/locales/en_US.js';
import esCL from '../../../i18n/locales/es_CL.js';
import AccountStatusSummary from '../AccountStatusSummary.jsx';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_FILTERS,
  accountActionErrorKey,
  accountStatusBadgeVariant,
  accountStatusOf
} from '../accountStatus.js';

function lookup(dictionary, key) {
  return key.split('.').reduce((node, part) => node?.[part], dictionary);
}

describe('account status', () => {
  it('uses the status the backend reports', () => {
    expect(accountStatusOf({ status: 'pending', active: true, emailConfirmed: true })).toBe('pending');
    expect(accountStatusOf({ status: 'anonymized' })).toBe('anonymized');
  });

  it('derives the status from the flags when the response has none', () => {
    expect(accountStatusOf({ active: false, emailConfirmed: false })).toBe('pending');
    expect(accountStatusOf({ active: false, emailConfirmed: true })).toBe('inactive');
    expect(accountStatusOf({ active: true, emailConfirmed: true })).toBe('active');
    expect(accountStatusOf({ status: 'unknown', active: true })).toBe('active');
  });

  it('tells pending and deactivated accounts apart in the badge', () => {
    expect(accountStatusBadgeVariant('pending')).toBe('warning');
    expect(accountStatusBadgeVariant('inactive')).toBe('secondary');
    expect(accountStatusBadgeVariant('active')).toBe('success');
  });

  it('translates the error codes of the confirm action and leaves others to the caller', () => {
    expect(accountActionErrorKey({ code: 'ACCOUNT_NOT_PENDING' })).toBe('pages.userShow.errors.accountNotPending');
    expect(accountActionErrorKey({ code: 'USER_NOT_FOUND' })).toBe('pages.userShow.errors.userNotFound');
    expect(accountActionErrorKey(new Error('INVALID_USER_ID'))).toBe('pages.userShow.errors.invalidUserId');
    expect(accountActionErrorKey({ code: 'Request failed' })).toBeNull();
  });

  it('explains each status on the account page', () => {
    for (const status of Object.values(ACCOUNT_STATUSES)) {
      const html = renderToStaticMarkup(<AccountStatusSummary status={status} />);

      expect(html).toContain('data-testid="account-status"');
      expect(html).toContain(`data-account-status="${status}"`);
      expect(html).toContain(`pages.userShow.accountStatus.${status}.label`);
      expect(html).toContain(`pages.userShow.accountStatus.${status}.description`);
    }
  });

  it('has every text in both locales', () => {
    const keys = [
      'filters.status',
      'filters.allStatuses',
      'pages.userShow.actions.confirmAccount',
      'pages.userShow.confirmAccountSuccess',
      'pages.userShow.confirmAccountError',
      'pages.userShow.status.pendingActivationHelp',
      'pages.userShow.confirm.confirmAccount.title',
      'pages.userShow.confirm.confirmAccount.body',
      'pages.userShow.confirm.confirmAccount.confirm',
      ...ACCOUNT_STATUS_FILTERS.map((status) => `pages.users.status.${status}`),
      ...Object.values(ACCOUNT_STATUSES).flatMap((status) => [
        `pages.userShow.accountStatus.${status}.label`,
        `pages.userShow.accountStatus.${status}.description`
      ]),
      ...['ACCOUNT_NOT_PENDING', 'USER_NOT_FOUND', 'INVALID_USER_ID'].map((code) => accountActionErrorKey({ code }))
    ];

    for (const locale of [enUS, esCL]) {
      for (const key of keys) {
        expect(typeof lookup(locale, key), key).toBe('string');
      }
    }
  });
});
