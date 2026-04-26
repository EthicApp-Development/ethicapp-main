const DEFAULT_LOCALE = 'en_US';

function normalizePreferredLocale(locale) {
  const normalizedLocale = String(locale || '').trim().toLowerCase().replace('-', '_');

  if (normalizedLocale.startsWith('es_') || normalizedLocale === 'es') {
    return 'es_CL';
  }

  return 'en_US';
}

function inferPreferredLocaleFromRequest(req) {
  const bodyLocale = (req.body?.preferred_locale || '').trim();

  if (bodyLocale) {
    return normalizePreferredLocale(bodyLocale);
  }

  const acceptLanguageHeader = String(req.headers['accept-language'] || '');
  const languageCandidates = acceptLanguageHeader
    .split(',')
    .map((entry) => entry.split(';')[0].trim())
    .filter(Boolean);

  return normalizePreferredLocale(languageCandidates[0] || DEFAULT_LOCALE);
}

function translateMessage(req, key, catalog) {
  const locale = inferPreferredLocaleFromRequest(req);
  return catalog[locale]?.[key] || catalog[DEFAULT_LOCALE]?.[key] || key;
}

module.exports = {
  DEFAULT_LOCALE,
  normalizePreferredLocale,
  inferPreferredLocaleFromRequest,
  translateMessage
};
