import { mutatingJsonHeaders, parseJson } from './usersApi.js';

// Forgets a student (#876). A refusal rejects with code ACCOUNT_ANONYMIZED,
// NOT_A_STUDENT or ACCOUNT_CHANGED.
export async function forgetStudent(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/forget`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

// The account's AI Additions erasure requests: { ok: true, requests } or
// { ok: false, error } when EthicApp cannot tell.
export async function fetchErasureRequests(userId) {
  const response = await fetch(`/mng/api/users/${userId}/erasure-requests`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}

// Retries the requests that are not done; resolves like fetchErasureRequests.
export async function retryErasureRequests(userId) {
  const response = await fetch(`/mng/api/users/${userId}/erasure-requests/retry`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify({})
  });

  return parseJson(response);
}
