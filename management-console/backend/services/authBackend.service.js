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
