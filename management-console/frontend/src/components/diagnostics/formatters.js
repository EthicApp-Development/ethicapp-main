export function formatLatency(latencyMs) {
  return Number.isFinite(latencyMs) ? `${latencyMs} ms` : '—';
}

export function formatDateTime(value, locale) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(String(locale).replace('_', '-'), {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(date);
}

export function formatAddressList(addresses = []) {
  return addresses.length > 0 ? addresses.join(', ') : '—';
}
