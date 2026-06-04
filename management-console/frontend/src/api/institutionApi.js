import { mutatingJsonHeaders, parseJson } from './usersApi.js';

export async function fetchInstitution() {
  const response = await fetch('/mng/api/institution', {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

export async function updateInstitution(payload) {
  const response = await fetch('/mng/api/institution', {
    method: 'PUT',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}
