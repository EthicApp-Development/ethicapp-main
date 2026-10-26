import { isSessionExpiredResponse, redirectToLogin } from './sessionRedirect.js';

function toQueryString(params) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      searchParams.set(key, String(value));
    }
  });

  return searchParams.toString();
}

// Errors thrown for a failed response carry `code`: the backend `error`
// value (for example PASSKEY_REQUIRED) or SESSION_EXPIRED.
export async function parseJson(response) {
  const contentType = response.headers.get('content-type') || '';
  const json = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};

  if (isSessionExpiredResponse(response, json)) {
    redirectToLogin();
    throw Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED' });
  }

  if (!response.ok) {
    const message = json.error || 'Request failed';
    throw Object.assign(new Error(message), { code: message });
  }

  return json;
}

let csrfTokenPromise = null;

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch('/mng/api/csrf-token', {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json'
      }
    })
      .then(parseJson)
      .then((json) => json.csrfToken)
      .catch((error) => {
        csrfTokenPromise = null;
        throw error;
      });
  }

  return csrfTokenPromise;
}

export async function mutatingJsonHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-CSRF-Token': await getCsrfToken()
  };
}

export async function fetchUsers({ keywords = '', role = '', page = 1 }) {
  const query = toQueryString({ q: keywords, role, page });
  const response = await fetch(`/mng/api/users?${query}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function fetchUserById(userId) {
  const response = await fetch(`/mng/api/users/${userId}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function updateUser(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function triggerPasswordReset(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/password-reset`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function impersonateProfessor(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/impersonate-professor`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}
