import translations from './translations.js';
import { DEFAULT_LOCALE } from './languages.js';

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

/**
 * @param {string} locale
 * @returns {(key: string, params?: object) => string}
 */
export function createTranslator(locale) {
  const localeDictionary = translations[locale] || translations[DEFAULT_LOCALE] || {};

  return function t(key, params) {
    const localizedText = getByPath(localeDictionary, key);
    return interpolate(localizedText ?? key, params);
  };
}
