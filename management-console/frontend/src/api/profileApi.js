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
