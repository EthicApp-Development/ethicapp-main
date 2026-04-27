const AUTH_BACKEND_INTERNAL_BASE_URL =
  process.env.AUTH_BACKEND_INTERNAL_BASE_URL || 'http://auth-backend:8502/api/auth';

function buildUrl(pathname) {
  return `${AUTH_BACKEND_INTERNAL_BASE_URL.replace(/\/$/, '')}${pathname}`;
}

export async function verifyAdminPasswordWithAuthBackend({ password, cookie, language }) {
  const response = await fetch(buildUrl('/admin/verify-password'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
      'Accept-Language': language || 'en-US'
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
      'Accept-Language': language || 'en-US'
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
