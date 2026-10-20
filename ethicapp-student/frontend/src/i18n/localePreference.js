import { detectPreferredLocale, resolveSupportedLocale } from './languages.js';

/**
 * Locale the student app renders in. The account's preferred_locale decides
 * once the profile has loaded; until then the browser language is used.
 *
 * The last account preference is kept when a later profile load fails or the
 * user is cleared, so messages shown during a failure, such as the
 * session-expiry notice, do not switch back to the browser language.
 * @param {{ detectBrowserLocale?: () => string }} [options]
 */
export function createLocalePreference({ detectBrowserLocale = detectPreferredLocale } = {}) {
  let accountLocale = null;
  let browserLocale = null;
  const listeners = new Set();

  const getSnapshot = () => {
    if (accountLocale) {
      return accountLocale;
    }

    browserLocale ??= detectBrowserLocale();
    return browserLocale;
  };

  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Applies the account's saved preference; empty values keep the current one. */
    setAccountLocale(preferredLocale) {
      const locale = resolveSupportedLocale(preferredLocale);

      if (!locale || locale === accountLocale) {
        return;
      }

      const previous = getSnapshot();
      accountLocale = locale;

      if (locale !== previous) {
        listeners.forEach((listener) => listener());
      }
    }
  };
}

export const localePreference = createLocalePreference();
