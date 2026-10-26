// Catalog and connection-test error codes from the console backend
// (services/ethicapp.service.js AI_SERVICES_ERROR_CODES).
const KNOWN_ERROR_CODES = new Set([
  'not_configured',
  'unreachable',
  'unauthorized',
  'invalid_response',
  'ethicapp_error'
]);

export function aiErrorKey(code) {
  return `pages.aiServices.errors.${KNOWN_ERROR_CODES.has(code) ? code : 'generic'}`;
}

export function serviceNamesById(services = []) {
  return new Map(services.map((service) => [service.id, service.name || service.id]));
}

export function formatServiceList(ids, namesById) {
  return ids.map((id) => namesById.get(id) || id).join(', ');
}
