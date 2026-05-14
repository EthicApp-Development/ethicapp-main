const RECAPTCHA_ENABLED = process.env.RECAPTCHA_ENABLED === 'true';
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || '';
const RECAPTCHA_VERIFY_URL =
  process.env.RECAPTCHA_VERIFY_URL || 'https://www.google.com/recaptcha/api/siteverify';

async function verifyRecaptchaToken({ token, remoteIp }) {
  if (!RECAPTCHA_ENABLED) {
    return true;
  }

  if (!RECAPTCHA_SECRET_KEY) {
    throw new Error(
      'reCAPTCHA is enabled but RECAPTCHA_SECRET_KEY is not configured'
    );
  }

  if (!token) {
    return false;
  }

  const params = new URLSearchParams();
  params.append('secret', RECAPTCHA_SECRET_KEY);
  params.append('response', token);

  if (remoteIp) {
    params.append('remoteip', remoteIp);
  }

  const response = await fetch(RECAPTCHA_VERIFY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error(`reCAPTCHA verification failed with status ${response.status}`);
  }

  const body = await response.json();
  return body.success === true;
}

const recaptchaService = {
  verifyRecaptchaToken
};

export { verifyRecaptchaToken };
export default recaptchaService;
