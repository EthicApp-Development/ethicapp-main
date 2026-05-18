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

function interpolate(localizedText, params = {}) {
  if (typeof localizedText !== 'string') {
    return localizedText;
  }

  return localizedText.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function AppProviders({ children }) {
  const locale = detectPreferredLocale();

  const contextValue = useMemo(() => {
    const localeDictionary = translations[locale] || translations[DEFAULT_LOCALE] || {};

    function t(key, params) {
      const localizedText = getByPath(localeDictionary, key);
      return interpolate(localizedText ?? key, params);
    }

    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}


export function useI18n() {
  return useContext(I18nContext);
}
