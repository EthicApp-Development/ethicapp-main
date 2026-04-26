export const SUPPORTED_LOCALES = {
  ES_CL: 'es_CL',
  EN_US: 'en_US'
};

export const DEFAULT_LOCALE = SUPPORTED_LOCALES.EN_US;

const localeDetectors = [
  () => (typeof navigator !== 'undefined' ? navigator.languages : undefined),
  () => (typeof navigator !== 'undefined' ? [navigator.language] : undefined),
  () => (typeof navigator !== 'undefined' ? [navigator.userLanguage] : undefined)
];

function normalizeLocale(locale) {
  return String(locale || '').trim().toLowerCase().replace('-', '_');
}

function matchSupportedLocale(locale) {
  const normalizedLocale = normalizeLocale(locale);

  if (!normalizedLocale) {
    return null;
  }

  if (normalizedLocale.startsWith('es')) {
    return SUPPORTED_LOCALES.ES_CL;
  }

  return SUPPORTED_LOCALES.EN_US;
}

export function detectPreferredLocale() {
  for (const getLocales of localeDetectors) {
    const candidates = getLocales();

    if (!Array.isArray(candidates)) {
      continue;
    }

    for (const candidate of candidates) {
      const matchedLocale = matchSupportedLocale(candidate);

      if (matchedLocale) {
        return matchedLocale;
      }
    }
  }

  return DEFAULT_LOCALE;
}
