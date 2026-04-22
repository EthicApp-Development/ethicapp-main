export function formatSessionDate(value) {
  if (!value) {
    return 'Sin fecha';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Sin fecha';
  }

  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function sessionStatusLabel(status) {
  const labels = {
    setup: 'Configuración',
    active: 'Activa',
    closed: 'Cerrada',
    archived: 'Archivada'
  };

  return labels[status] ?? status ?? 'Sin estado';
}
