import { mutatingJsonHeaders } from './usersApi.js';
import { isLoginResponse, redirectToLogin } from './sessionRedirect.js';

const BASE_PATH = '/mng/api/ai-services';

// Like usersApi.parseJson, but keeps the whole error body on the thrown error
// (error.code plus fields such as unknownServiceIds or catalogError).
async function parseResponse(response) {
  if (response.status === 401 || isLoginResponse(response)) {
    redirectToLogin();
    throw Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED', body: {} });
  }

  const contentType = response.headers.get('content-type') || '';
  const json = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};

  if (!response.ok) {
    const code = json.error || 'REQUEST_FAILED';
    throw Object.assign(new Error(code), { code, body: json });
  }

  return json;
}

async function getJson(path) {
  const response = await fetch(`${BASE_PATH}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' }
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

export async function saveConnection({ baseUrl, keycloakPublicUrl }) {
  return (await sendJson('PUT', '/connection', { baseUrl, keycloakPublicUrl })).connection;
}

export function removeConnection() {
  return sendJson('DELETE', '/connection', { confirm: true });
}

export function testConnection({ baseUrl, keycloakPublicUrl }) {
  return sendJson('POST', '/connection/test', { baseUrl, keycloakPublicUrl });
}

export function fetchCatalog(locale) {
  return getJson(`/catalog?${new URLSearchParams({ locale }).toString()}`);
}

export function fetchPolicy() {
  return getJson('/policy');
}

export async function createPolicyVersion({ allowedServiceIds, note }) {
  return (await sendJson('POST', '/policy', { allowedServiceIds, note })).version;
}
