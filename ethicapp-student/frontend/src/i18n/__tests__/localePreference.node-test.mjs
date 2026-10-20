import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionExpiryFlow } from '../../api/sessionExpiry.js';
import { toStudentUser } from '../../context/studentProfile.js';
import { createLocalePreference } from '../localePreference.js';
import { createTranslator } from '../translator.js';
import enUS from '../locales/en_US.js';
import esCL from '../locales/es_CL.js';

function profileResponse(preferredLocale) {
  return { success: true, data: { id: 44, firstname: 'Ana', preferred_locale: preferredLocale } };
}

// What the expiry notice renders, given the locale the provider would use.
function expiryNoticeText(preference) {
  return createTranslator(preference.getSnapshot())('apiErrors.sessionExpired');
}

test('the browser language applies until the profile is available', () => {
  const preference = createLocalePreference({ detectBrowserLocale: () => 'es_CL' });

  assert.equal(preference.getSnapshot(), 'es_CL');
});

for (const [browserLocale, accountLocale] of [['en_US', 'es_CL'], ['es_CL', 'en_US']]) {
  test(`an account preferring ${accountLocale} overrides a ${browserLocale} browser, notifying once`, () => {
    const preference = createLocalePreference({ detectBrowserLocale: () => browserLocale });
    let notifications = 0;
    preference.subscribe(() => {
      notifications += 1;
    });

    preference.setAccountLocale(toStudentUser(profileResponse(accountLocale)).preferredLocale);
    preference.setAccountLocale(accountLocale);

    assert.equal(preference.getSnapshot(), accountLocale);
    assert.equal(notifications, 1);
  });

  test(`the expiry notice stays in ${accountLocale} after a failed reload with a ${browserLocale} browser`, () => {
    const preference = createLocalePreference({ detectBrowserLocale: () => browserLocale });
    const flow = createSessionExpiryFlow({ redirect: () => {}, schedule: () => {} });
    const expected = (accountLocale === 'es_CL' ? esCL : enUS).apiErrors.sessionExpired;

    preference.setAccountLocale(toStudentUser(profileResponse(accountLocale)).preferredLocale);

    // A later profile load fails: the context clears the user and has no
    // preference to report, so nothing reaches the locale preference.
    preference.setAccountLocale(toStudentUser(undefined).preferredLocale);
    preference.setAccountLocale(null);
    flow.start({ requestId: 'req-1' });

    assert.equal(preference.getSnapshot(), accountLocale);
    assert.equal(expiryNoticeText(preference), expected);
  });
}

test('saved preferences follow the canonical locale rule', () => {
  const cases = [['es', 'es_CL'], ['es-AR', 'es_CL'], ['es_CL', 'es_CL'], ['en_US', 'en_US'], ['pt_BR', 'en_US']];

  for (const [saved, expected] of cases) {
    const preference = createLocalePreference({ detectBrowserLocale: () => 'en_US' });
    preference.setAccountLocale(saved);
    assert.equal(preference.getSnapshot(), expected, saved);
  }
});

test('a preference equal to the browser language does not notify', () => {
  const preference = createLocalePreference({ detectBrowserLocale: () => 'es_CL' });
  let notifications = 0;
  preference.subscribe(() => {
    notifications += 1;
  });

  preference.setAccountLocale('es_CL');

  assert.equal(preference.getSnapshot(), 'es_CL');
  assert.equal(notifications, 0);
});

test('createTranslator falls back to the key and interpolates parameters', () => {
  const t = createTranslator('es_CL');

  assert.equal(t('apiErrors.reference', { requestId: 'abc' }), '(Referencia: abc)');
  assert.equal(t('missing.key'), 'missing.key');
});
