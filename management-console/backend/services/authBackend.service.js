const AUTH_BACKEND_INTERNAL_BASE_URL =
  process.env.AUTH_BACKEND_INTERNAL_BASE_URL || 'http://auth-backend:8502/api/auth';
const DEVELOPMENT_INTERNAL_SERVICE_TOKEN = 'development-internal-service-token';

function getInternalServiceToken() {
  const configuredToken = (process.env.AUTH_INTERNAL_SERVICE_TOKEN || '').trim();

  if (configuredToken) {
    return configuredToken;
  }

  return process.env.NODE_ENV === 'production'
    ? ''
    : DEVELOPMENT_INTERNAL_SERVICE_TOKEN;
}

function buildUrl(pathname) {
  return `${AUTH_BACKEND_INTERNAL_BASE_URL.replace(/\/$/, '')}${pathname}`;
}

function internalServiceHeaders() {
  const token = getInternalServiceToken();

  return token
    ? { 'X-Internal-Service-Token': token }
    : {};
}

function originHeader(origin) {
  return origin
    ? { Origin: origin }
    : {};
}

export async function verifyAdminPasswordWithAuthBackend({ password, cookie, language }) {
  const response = await fetch(buildUrl('/admin/verify-password'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    },
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    return false;
  }

  const body = await response.json();
  return body?.ok === true;
}

export async function changeAdminPasswordWithAuthBackend({
  currentPassword,
  newPassword,
  passwordConfirmation,
  cookie,
  language
}) {
  const response = await fetch(buildUrl('/admin/change-password'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      password_confirmation: passwordConfirmation
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'CHANGE_PASSWORD_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function listAdminPasskeysWithAuthBackend({ cookie, language }) {
  const response = await fetch(buildUrl('/admin/passkeys'), {
    method: 'GET',
    headers: {
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'LIST_PASSKEYS_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function startAdminPasskeyRegistrationWithAuthBackend({ password, cookie, language, origin }) {
  const response = await fetch(buildUrl('/admin/passkeys/registration-options'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...originHeader(origin),
      ...internalServiceHeaders()
    },
    body: JSON.stringify({ password })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'PASSKEY_REGISTRATION_OPTIONS_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function finishAdminPasskeyRegistrationWithAuthBackend({
  credential,
  name,
  cookie,
  language,
  origin
}) {
  const response = await fetch(buildUrl('/admin/passkeys/register'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...originHeader(origin),
      ...internalServiceHeaders()
    },
    body: JSON.stringify({ credential, name })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'PASSKEY_REGISTRATION_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function startAdminPasskeyAuthenticationWithAuthBackend({ cookie, language, origin }) {
  const response = await fetch(buildUrl('/admin/passkeys/authentication-options'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...originHeader(origin),
      ...internalServiceHeaders()
    },
    body: JSON.stringify({})
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'PASSKEY_AUTHENTICATION_OPTIONS_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function verifyAdminPasskeyWithAuthBackend({ assertion, cookie, language, origin }) {
  const response = await fetch(buildUrl('/admin/passkeys/verify'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...originHeader(origin),
      ...internalServiceHeaders()
    },
    body: JSON.stringify({ assertion })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'PASSKEY_AUTHENTICATION_FAILED');
    error.status = response.status;
    throw error;
  }

  return body?.ok === true;
}

export async function deleteAdminPasskeyWithAuthBackend({ passkeyId, password, cookie, language }) {
  const response = await fetch(buildUrl(`/admin/passkeys/${passkeyId}`), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    },
    body: JSON.stringify({ password })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'DELETE_PASSKEY_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

export async function triggerForgotPasswordWithAuthBackend({ email, recaptchaToken, cookie, language }) {
  const response = await fetch(buildUrl('/forgot'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    },
    body: JSON.stringify({
      email,
      recaptcha_token: recaptchaToken
    })
  });

  if (!response.ok) {
    throw new Error('FORGOT_REQUEST_FAILED');
  }

  return response.json();
}

export async function triggerAdminPasswordResetWithAuthBackend({ email, cookie, language }) {
  const response = await fetch(buildUrl('/admin/password-reset'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    },
    body: JSON.stringify({
      email
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error || 'ADMIN_PASSWORD_RESET_FAILED');
    error.status = response.status;
    throw error;
  }

  return body;
}

// Sets the password of a student or teacher account (#889), through
// auth-backend's internal endpoint, after the console's step-up check.
// auth-backend decides everything: the strength rule, the target and the
// expected email.
//
// Resolves to { ok: true, message } when the password was set, or to
// { ok: false, status, code, message } when auth-backend refused it or
// failed: `code` is its machine-readable code (WEAK_PASSWORD,
// ACCOUNT_CHANGED, ...) or null, and `message` its localized text. Rejects
// only when auth-backend cannot be reached. The password is sent in the body
// only, and no field of the request is ever placed in an error.
export async function setUserPasswordWithAuthBackend({
  userId,
  newPassword,
  passwordConfirmation,
  expectedEmail,
  cookie,
  language,
  fetchImpl = fetch
}) {
  const response = await fetchImpl(buildUrl(`/admin/users/${encodeURIComponent(userId)}/password`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US',
      ...internalServiceHeaders()
    },
    body: JSON.stringify({
      new_password: newPassword,
      password_confirmation: passwordConfirmation,
      expected_email: expectedEmail
    })
  });

  const body = await response.json().catch(() => ({}));
  const message = typeof body?.error === 'string' ? body.error : '';

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: typeof body?.code === 'string' ? body.code : null,
      message
    };
  }

  return {
    ok: true,
    message: typeof body?.message === 'string' ? body.message : ''
  };
}
