import PropTypes from 'prop-types';
import { createContext, useContext, useMemo } from 'react';
import translations from '../i18n/translations.js';
import { DEFAULT_LOCALE, detectPreferredLocale } from '../i18n/languages.js';

const I18nContext = createContext({
  locale: DEFAULT_LOCALE,
  t: (key) => key
});

function getByPath(dictionary, path) {
  return path
    .split('.')
    .reduce((memo, current) => (memo && memo[current] !== undefined ? memo[current] : undefined), dictionary);
}

export function AppProviders({ children }) {
  const locale = detectPreferredLocale();

  const contextValue = useMemo(() => {
    const dictionary = translations[locale] || translations[DEFAULT_LOCALE] || {};

    const t = (key, replacements = {}) => {
      const template = getByPath(dictionary, key) ?? key;

      if (typeof template !== 'string') {
        return template;
      }

      return Object.entries(replacements).reduce(
        (text, [replacementKey, replacementValue]) =>
          text.replaceAll(`{{${replacementKey}}}`, String(replacementValue)),
        template
      );
    };

    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

AppProviders.propTypes = {
  children: PropTypes.node.isRequired
};

export function useI18n() {
  return useContext(I18nContext);
}
