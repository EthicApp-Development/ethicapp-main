import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { DEFAULT_LOCALE } from '../i18n/languages.js';
import { localePreference } from '../i18n/localePreference.js';
import { createTranslator } from '../i18n/translator.js';

const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  t: (key) => key
});

export function AppProviders({ children }) {
  const locale = useSyncExternalStore(localePreference.subscribe, localePreference.getSnapshot);

  const contextValue = useMemo(() => ({ locale, t: createTranslator(locale) }), [locale]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}


export function useI18n() {
  return useContext(I18nContext);
}
