import { mutatingJsonHeaders, parseJson } from './usersApi.js';

// Both checks are POST endpoints: each call makes the backend contact the
// configured targets. The body is ignored by the server.
async function runHealthCheck(check) {
  const response = await fetch(`/mng/api/health/${check}`, {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: '{}'
  });

  return parseJson(response);
}

export function runDnsCheck() {
  return runHealthCheck('dns');
}

export function runConnectivityCheck() {
  return runHealthCheck('connectivity');
}
