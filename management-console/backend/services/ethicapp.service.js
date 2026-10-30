const ETHICAPP_INTERNAL_BASE_URL = process.env.ETHICAPP_INTERNAL_BASE_URL || 'http://ethicapp:8501';

export function buildUrl(pathname) {
  return `${ETHICAPP_INTERNAL_BASE_URL.replace(/\/$/, '')}${pathname}`;
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  const setCookie = response.headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
}

async function parseResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export async function impersonateProfessorInEthicapp({
  professorId,
  cookie,
  userId,
  userRole,
  forwardedProto,
  forwardedHost,
  forwardedPort
}) {
  const response = await fetch(buildUrl(`/api/admin/impersonation/professor/${professorId}`), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: cookie || '',
      'X-User-Id': String(userId || ''),
      'X-User-Role': String(userRole || ''),
      'X-Forwarded-Proto': forwardedProto || 'https',
      'X-Forwarded-Host': forwardedHost || '',
      'X-Forwarded-Port': forwardedPort || ''
    }
  });

  if (!response.ok) {
    const errorBody = await parseResponseBody(response);
    throw new Error(errorBody.error || 'IMPERSONATION_FAILED');
  }

  return {
    body: await parseResponseBody(response),
    setCookies: getSetCookieHeaders(response)
  };
}

// --- AI services (epic #810): internal-only ethicapp endpoints (#816) -------
//
// ethicapp holds the AI Additions credentials; the console only asks it to
// read the catalog or to test a connection. The console authenticates the same
// way as impersonation start: it forwards the operator's cookie and the auth
// proxy identity headers over the internal network.
//
// Results are always returned as values, never thrown: { ok: false, error }
// with one of AI_SERVICES_ERROR_CODES. Response bodies are sanitized to the
// documented fields and are never logged.

export const AI_SERVICES_ERROR_CODES = Object.freeze([
  'not_configured',
  // EthicApp's own AI_ADDITIONS_KEYCLOAK_CLIENT_ID or _SECRET is empty (#838):
  // no request reached AI Additions.
  'credentials_missing',
  'unreachable',
  'unauthorized',
  'invalid_response',
  // ethicapp itself failed or rejected the call (for example, the internal
  // endpoint is missing or answered with an unexpected status).
  'ethicapp_error'
]);

const AI_ADDITIONS_ERROR_CODES = new Set(AI_SERVICES_ERROR_CODES.filter((code) => code !== 'ethicapp_error'));
const AI_SERVICES_CATALOG_TIMEOUT_MS = 15000;
const AI_SERVICES_CONNECTION_TEST_TIMEOUT_MS = 20000;

export function internalIdentityHeaders({ cookie, userId, userRole, language }) {
  return {
    Accept: 'application/json',
    Cookie: cookie || '',
    'X-User-Id': String(userId || ''),
    'X-User-Role': String(userRole || ''),
    'Accept-Language': language || 'en-US'
  };
}

// Fetches JSON from ethicapp. Transport failures (DNS, refused connection,
// timeout) become { transportError: true }; a non-JSON body becomes
// { body: null }.
export async function fetchInternalJson(url, init, { fetchImpl, timeoutMs }) {
  let response;

  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { transportError: true };
  }

  let body = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  return { status: response.status, ok: response.ok, body };
}

function knownErrorCode(value) {
  return typeof value === 'string' && AI_ADDITIONS_ERROR_CODES.has(value) ? value : null;
}

// Maps a non-successful exchange with ethicapp to an error code.
function errorFromExchange(exchange) {
  if (exchange.transportError) {
    return 'unreachable';
  }

  return knownErrorCode(exchange.body?.error) || (exchange.ok ? 'invalid_response' : 'ethicapp_error');
}

function optionalString(value) {
  return typeof value === 'string' ? value : null;
}

// The scopes an EthicApp adapter can work on (SERVICE_SCOPES in ethicapp's
// external-services.service.js); the console groups adapters by them.
export const ADAPTER_SCOPES = Object.freeze(['case', 'design', 'response', 'chat']);

function sanitizeAdapter(adapter) {
  if (!adapter || typeof adapter.id !== 'string' || !adapter.id) {
    return null;
  }

  return {
    id: adapter.id,
    label: optionalString(adapter.label),
    description: optionalString(adapter.description),
    scopes: Array.isArray(adapter.scopes)
      ? ADAPTER_SCOPES.filter((scope) => adapter.scopes.includes(scope))
      : []
  };
}

function sanitizeService(service) {
  if (!service || typeof service.id !== 'string' || !service.id) {
    return null;
  }

  return {
    id: service.id,
    name: optionalString(service.name) || service.id,
    description: optionalString(service.description),
    usesLlm: service.usesLlm === true,
    status: optionalString(service.status),
    available: service.available === true,
    adapters: Array.isArray(service.adapters)
      ? service.adapters.map(sanitizeAdapter).filter(Boolean)
      : []
  };
}

export function sanitizeCatalogBody(body) {
  if (!body || body.ok !== true || !Array.isArray(body.services)) {
    return null;
  }

  const services = body.services.map(sanitizeService);

  if (services.some((service) => service === null)) {
    return null;
  }

  return {
    ok: true,
    contractVersion: optionalString(body.contractVersion),
    locale: optionalString(body.locale),
    services
  };
}

export async function fetchAiServicesCatalogFromEthicapp({
  locale,
  cookie,
  userId,
  userRole,
  language,
  fetchImpl = fetch,
  timeoutMs = AI_SERVICES_CATALOG_TIMEOUT_MS
}) {
  const searchParams = new URLSearchParams({ locale: locale || 'en_US' });
  const exchange = await fetchInternalJson(
    buildUrl(`/api/admin/ai-services/catalog?${searchParams.toString()}`),
    {
      method: 'GET',
      headers: internalIdentityHeaders({ cookie, userId, userRole, language })
    },
    { fetchImpl, timeoutMs }
  );

  if (exchange.ok) {
    const catalog = sanitizeCatalogBody(exchange.body);

    if (catalog) {
      return catalog;
    }
  }

  return { ok: false, error: errorFromExchange(exchange) };
}

function sanitizeStep(step) {
  if (!step || typeof step !== 'object') {
    return null;
  }

  if (step.ok === true) {
    return { ok: true, error: null, skipped: false };
  }

  if (step.skipped === true) {
    return { ok: false, error: null, skipped: true };
  }

  return { ok: false, error: knownErrorCode(step.error) || 'invalid_response', skipped: false };
}

// The issuer step (#834) also reports `issuer_mismatch`: the token's `iss`
// differs from the issuer ethicapp expects for the tested connection.
export const ISSUER_MISMATCH = 'issuer_mismatch';
const MAX_ISSUER_LENGTH = 2048;

// An issuer passes through only as an http(s) URL of at most 2048 characters.
function issuerUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_ISSUER_LENGTH || !/^https?:\/\/[^\s]+$/i.test(value)) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

// Unlike the token and catalog steps, an absent issuer step is not an error:
// an ethicapp older than #834 does not report it. It is then null.
function sanitizeIssuerStep(step) {
  if (!step || typeof step !== 'object') {
    return null;
  }

  const expected = issuerUrl(step.expected);
  const actual = issuerUrl(step.actual);

  if (step.ok === true) {
    return { ok: true, error: null, skipped: false, expected, actual };
  }

  if (step.skipped === true) {
    return { ok: false, error: null, skipped: true, expected, actual: null };
  }

  const error = step.error === ISSUER_MISMATCH ? ISSUER_MISMATCH : (knownErrorCode(step.error) || 'invalid_response');
  return { ok: false, error, skipped: false, expected, actual };
}

const SKIPPED_STEP = Object.freeze({ ok: false, error: null, skipped: true });

function failedConnectionTest(error) {
  return {
    ok: false,
    error,
    token: { ...SKIPPED_STEP },
    issuer: { ...SKIPPED_STEP, expected: null, actual: null },
    catalog: { ...SKIPPED_STEP },
    serviceCount: null
  };
}

// ethicapp is expected to answer
//   { ok, token: { ok, error? }, issuer: { ok, error?, skipped?, expected, actual? },
//     catalog: { ok, error?, skipped? }, serviceCount }
// where error is one of the AI Additions codes, or `issuer_mismatch` for the
// issuer step. The console adds a top-level error when the exchange with
// ethicapp itself fails.
export function sanitizeConnectionTestBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const token = sanitizeStep(body.token);
  const catalog = sanitizeStep(body.catalog);

  if (!token || !catalog) {
    return null;
  }

  const issuer = sanitizeIssuerStep(body.issuer);
  const serviceCount = Number.isInteger(body.serviceCount) && body.serviceCount >= 0
    ? body.serviceCount
    : null;
  const ok = token.ok && catalog.ok && (issuer ? issuer.ok : true);

  return {
    ok,
    error: ok ? null : (token.error || issuer?.error || catalog.error || 'invalid_response'),
    token,
    issuer,
    catalog,
    serviceCount: catalog.ok ? serviceCount : null
  };
}

export async function testAiAdditionsConnectionInEthicapp({
  baseUrl,
  keycloakPublicUrl,
  cookie,
  userId,
  userRole,
  language,
  fetchImpl = fetch,
  timeoutMs = AI_SERVICES_CONNECTION_TEST_TIMEOUT_MS
}) {
  const exchange = await fetchInternalJson(
    buildUrl('/api/admin/ai-services/connection-test'),
    {
      method: 'POST',
      headers: {
        ...internalIdentityHeaders({ cookie, userId, userRole, language }),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        baseUrl,
        ...(keycloakPublicUrl ? { keycloakPublicUrl } : {})
      })
    },
    { fetchImpl, timeoutMs }
  );

  if (exchange.transportError) {
    return failedConnectionTest('unreachable');
  }

  // A failing step is a normal answer, whatever the status code, as long as
  // the body has the documented shape.
  const result = sanitizeConnectionTestBody(exchange.body);

  if (result) {
    return result;
  }

  return failedConnectionTest(exchange.ok ? 'invalid_response' : 'ethicapp_error');
}
