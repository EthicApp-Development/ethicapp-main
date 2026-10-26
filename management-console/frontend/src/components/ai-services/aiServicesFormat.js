// Catalog and connection-test error codes from the console backend
// (services/ethicapp.service.js AI_SERVICES_ERROR_CODES).
const KNOWN_ERROR_CODES = new Set([
  'not_configured',
  'credentials_missing',
  'unreachable',
  'unauthorized',
  'invalid_response',
  'issuer_mismatch',
  'ethicapp_error'
]);

export function aiErrorKey(code) {
  return `pages.aiServices.errors.${KNOWN_ERROR_CODES.has(code) ? code : 'generic'}`;
}

const REALM_SUFFIX = /^(https?:\/\/.+?)\/realms\/([^/]+)\/?$/i;

// What to tell the operator after an issuer mismatch. An issuer is
// `<Keycloak public URL>/realms/<realm>`, so the Keycloak public URL that
// matches the token is `actual` without its `/realms/<realm>` suffix, when
// the realm is the expected one. When the realms differ, no Keycloak public
// URL can fix it. Returns null when `actual` is not shaped like an issuer.
export function issuerMismatchHint(expected, actual) {
  const actualMatch = typeof actual === 'string' ? REALM_SUFFIX.exec(actual) : null;
  if (!actualMatch) {
    return null;
  }

  const expectedMatch = typeof expected === 'string' ? REALM_SUFFIX.exec(expected) : null;
  if (expectedMatch && expectedMatch[2] !== actualMatch[2]) {
    return { realmMismatch: true, keycloakPublicUrl: null };
  }

  return { realmMismatch: false, keycloakPublicUrl: actualMatch[1] };
}

export function serviceNamesById(services = []) {
  return new Map(services.map((service) => [service.id, service.name || service.id]));
}

export function formatServiceList(ids, namesById) {
  return ids.map((id) => namesById.get(id) || id).join(', ');
}
