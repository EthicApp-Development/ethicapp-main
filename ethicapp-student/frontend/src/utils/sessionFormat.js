export function formatSessionDate(value, locale, t) {
  if (!value) {
    return t('sessions.noDate');
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return t('sessions.noDate');
  }

  const dateLocale = locale === 'es_CL' ? 'es-CL' : 'en-US';

  return new Intl.DateTimeFormat(dateLocale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function sessionStatusLabel(status, t) {
  if (!status) {
    return t('sessions.noStatus');
  }

  const key = `sessions.status.${status}`;
  const translatedStatus = t(key);
  return translatedStatus === key ? status : translatedStatus;
}
