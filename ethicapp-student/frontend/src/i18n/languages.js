export const SUPPORTED_LOCALES = {
  ES_CL: 'es_CL',
  EN_US: 'en_US'
};

export const DEFAULT_LOCALE = SUPPORTED_LOCALES.EN_US;

function normalizeLocale(locale) {
  return String(locale || '').trim().toLowerCase().replace('-', '_');
}

function resolveSupportedLocale(candidateLocale) {
  const normalizedLocale = normalizeLocale(candidateLocale);

  if (!normalizedLocale) {
    return null;
  }

  if (normalizedLocale.startsWith('es')) {
    return SUPPORTED_LOCALES.ES_CL;
  }

  return SUPPORTED_LOCALES.EN_US;
}

export function detectPreferredLocale() {
  const localeCandidates = [
    ...(typeof navigator !== 'undefined' && Array.isArray(navigator.languages)
      ? navigator.languages
      : []),
    typeof navigator !== 'undefined' ? navigator.language : null,
    typeof navigator !== 'undefined' ? navigator.userLanguage : null
  ];

  for (const localeCandidate of localeCandidates) {
    const locale = resolveSupportedLocale(localeCandidate);

    if (locale) {
      return locale;
    }
  }

  return DEFAULT_LOCALE;
}
