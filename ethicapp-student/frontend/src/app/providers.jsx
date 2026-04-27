import { createContext, useContext, useMemo } from 'react';
import translations from '../i18n/translations.js';
import { DEFAULT_LOCALE, detectPreferredLocale } from '../i18n/languages.js';

const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  t: (key) => key
});

function getByPath(dictionary, dottedPath) {
  return dottedPath
    .split('.')
    .reduce((value, segment) => (value && value[segment] !== undefined ? value[segment] : undefined), dictionary);
}

export function AppProviders({ children }) {
  const locale = detectPreferredLocale();

  const contextValue = useMemo(() => {
    const localeDictionary = translations[locale] || translations[DEFAULT_LOCALE] || {};

    function t(key) {
      const localizedText = getByPath(localeDictionary, key);
      return localizedText ?? key;
    }

    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}


export function useI18n() {
  return useContext(I18nContext);
}
