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
// value (for example PASSKEY_REQUIRED) or SESSION_EXPIRED, and `body`, the
// parsed response, for the details some refusals add.
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
    throw Object.assign(new Error(message), { code: message, body: json });
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

export async function fetchUsers({ keywords = '', role = '', status = '', sort = '', page = 1 }) {
  const query = toQueryString({ q: keywords, role, status, sort, page });
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

// Confirms an account whose owner never confirmed the email. A refusal
// rejects with code ACCOUNT_NOT_PENDING when the account is not pending.
export async function confirmAccount(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/confirm-account`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

// Deletes an account that was never activated. A refusal rejects with code
// ACCOUNT_NOT_DELETABLE, ACCOUNT_CHANGED or ACCOUNT_REFERENCED; for the last
// one, `body.referenced_by` names the table and `body.reference_category`
// the kind of data.
export async function deleteAccount(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}`, {
    method: 'DELETE',
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
