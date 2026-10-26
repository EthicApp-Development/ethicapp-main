import { mutatingJsonHeaders } from './usersApi.js';
import { isSessionExpiredResponse, redirectToLogin } from './sessionRedirect.js';

const BASE_PATH = '/mng/api/ai-services';

// Like usersApi.parseJson, but keeps the whole error body on the thrown error
// (error.code plus fields such as unknownServiceIds or catalogError).
async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const json = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};

  if (isSessionExpiredResponse(response, json)) {
    redirectToLogin();
    throw Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED', body: {} });
  }

  if (!response.ok) {
    const code = json.error || 'REQUEST_FAILED';
    throw Object.assign(new Error(code), { code, body: json });
  }

  return json;
}

async function getJson(path, { signal } = {}) {
  const response = await fetch(`${BASE_PATH}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal
  });
  return parseResponse(response);
}

async function sendJson(method, path, payload) {
  const response = await fetch(`${BASE_PATH}${path}`, {
    method,
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });
  return parseResponse(response);
}

export async function fetchConnection() {
  return (await getJson('/connection')).connection;
}

// The writes below need the administrator's step-up confirmation:
// `stepUp` is { passkey_assertion } or { admin_password, recaptcha_token }
// (see components/common/sensitiveActionConfirmation.js).
export async function saveConnection({ baseUrl, keycloakPublicUrl }, stepUp = {}) {
  return (await sendJson('PUT', '/connection', { baseUrl, keycloakPublicUrl, ...stepUp })).connection;
}

export function removeConnection(stepUp = {}) {
  return sendJson('DELETE', '/connection', { ...stepUp });
}

export function testConnection({ baseUrl, keycloakPublicUrl }) {
  return sendJson('POST', '/connection/test', { baseUrl, keycloakPublicUrl });
}

export function fetchCatalog(locale, { signal } = {}) {
  return getJson(`/catalog?${new URLSearchParams({ locale }).toString()}`, { signal });
}

export function fetchPolicy() {
  return getJson('/policy');
}

export async function createPolicyVersion({ allowedServiceIds, note }, stepUp = {}) {
  return (await sendJson('POST', '/policy', { allowedServiceIds, note, ...stepUp })).version;
}
