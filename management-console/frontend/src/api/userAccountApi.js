import { mutatingJsonHeaders, parseJson } from './usersApi.js';

// Creates a student or teacher account (#1170), active and with its email
// confirmed. Resolves to { id, message, welcome_email_sent }. A refusal
// rejects with `code` set to the refusal's code (EMAIL_ALREADY_REGISTERED,
// WEAK_PASSWORD, PRIVACY_NOTICE_NOT_CONFIRMED, ...) and `body.message` to
// auth-backend's localized text when it has one.
export async function createUserAccount(payload) {
  const response = await fetch('/mng/api/users', {
    method: 'POST',
    credentials: 'include',
    headers: await mutatingJsonHeaders(),
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}
