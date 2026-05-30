import { mutatingJsonHeaders, parseJson } from './usersApi.js';

export async function fetchProfile() {
  const response = await fetch('/mng/api/profile', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function changeOwnPassword(payload) {
  const response = await fetch('/mng/api/profile/password', {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function fetchPasskeys() {
  const response = await fetch('/mng/api/profile/passkeys', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function startPasskeyRegistration(payload) {
  const response = await fetch('/mng/api/profile/passkeys/registration-options', {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function finishPasskeyRegistration(payload) {
  const response = await fetch('/mng/api/profile/passkeys/register', {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

export async function startPasskeyAuthentication() {
  const response = await fetch('/mng/api/profile/passkeys/authentication-options', {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify({})
  });

  return parseJson(response);
}

export async function deletePasskey(passkeyId, payload) {
  const response = await fetch(`/mng/api/profile/passkeys/${passkeyId}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}
