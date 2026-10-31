import { mutatingJsonHeaders, parseJson } from './usersApi.js';

async function postForget(userId, payload) {
  const response = await fetch(`/mng/api/users/${userId}/forget`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}

// Forgets a student (#876). A refusal rejects with code ACCOUNT_ANONYMIZED,
// NOT_A_STUDENT or ACCOUNT_CHANGED.
export async function forgetStudent(userId, payload) {
  return postForget(userId, payload);
}

// The account's background erasure: { ok: true, requests, uploadDeletions },
// the AI Additions erasure requests and the summary of the file deletions,
// or { ok: false, error } when EthicApp cannot tell.
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

// Forgets a teacher (#877): `payload` carries the step-up fields,
// `expected_email` and, optionally, `recipient_id` and
// `expected_recipient_email`. Besides the student's refusals, it may reject
// with NOT_A_TEACHER, INVALID_RECIPIENT, RECIPIENT_UNAVAILABLE,
// RECIPIENT_CHANGED, OPEN_ACTIVITIES or ACTIVITIES_NOT_FINISHED.
export async function forgetTeacher(userId, payload) {
  return postForget(userId, { ...payload, expected_role: 'P' });
}

// What forgetting the teacher would do: { openActivities: { ok, count,
// error? }, cases: { delete, keep }, designs: { delete, keep }, activities,
// copiesByOthers: { cases, designs } }.
export async function fetchForgetPreview(userId) {
  const response = await fetch(`/mng/api/users/${userId}/forget-preview`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    }
  });

  return parseJson(response);
}
