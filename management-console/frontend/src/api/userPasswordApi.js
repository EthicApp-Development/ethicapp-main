import { mutatingJsonHeaders, parseJson } from './usersApi.js';

// Sets the password of a student or teacher account (#889). A refusal
// rejects with `code` set to auth-backend's code (WEAK_PASSWORD,
// PASSWORDS_DO_NOT_MATCH, ACCOUNT_CHANGED, ...) and `body.message` to its
// localized text.
export async function setUserPassword(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/password`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

// The password strength limits { minLength, minSymbols }, from auth-backend's
// public endpoint. auth-backend alone decides; these only drive the live
// checklist.
export async function fetchPasswordPolicy() {
  const response = await fetch('/api/auth/password-policy', {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error('PASSWORD_POLICY_UNAVAILABLE');
  }

  return response.json();
}
