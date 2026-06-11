const DEFAULT_CLASSIC_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const RECAPTCHA_PROVIDER_CLASSIC = 'classic';
const RECAPTCHA_PROVIDER_ENTERPRISE = 'enterprise';

function isRecaptchaEnabled() {
  return process.env.RECAPTCHA_ENABLED === 'true';
}

function getRecaptchaProvider() {
  return (process.env.RECAPTCHA_PROVIDER || RECAPTCHA_PROVIDER_CLASSIC)
    .trim()
    .toLowerCase();
}

function getEnterpriseAssessmentUrl() {
  const projectId = process.env.RECAPTCHA_ENTERPRISE_PROJECT_ID || '';
  const apiKey = process.env.RECAPTCHA_ENTERPRISE_API_KEY || '';

  if (!projectId) {
    throw new Error(
      'reCAPTCHA Enterprise is enabled but RECAPTCHA_ENTERPRISE_PROJECT_ID is not configured'
    );
  }

  if (!apiKey) {
    throw new Error(
      'reCAPTCHA Enterprise is enabled but RECAPTCHA_ENTERPRISE_API_KEY is not configured'
    );
  }

  const encodedProjectId = encodeURIComponent(projectId);
  const encodedApiKey = encodeURIComponent(apiKey);
  return `https://recaptchaenterprise.googleapis.com/v1/projects/${encodedProjectId}/assessments?key=${encodedApiKey}`;
}

async function verifyClassicRecaptchaToken({ token, remoteIp }) {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY || '';
  const verifyUrl = process.env.RECAPTCHA_VERIFY_URL || DEFAULT_CLASSIC_VERIFY_URL;

  if (!secretKey) {
    throw new Error(
      'reCAPTCHA is enabled but RECAPTCHA_SECRET_KEY is not configured'
    );
  }

  const params = new URLSearchParams();
  params.append('secret', secretKey);
  params.append('response', token);

  if (remoteIp) {
    params.append('remoteip', remoteIp);
  }

  const response = await fetch(verifyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error(
      `reCAPTCHA verification failed with status ${response.status}`
    );
  }

  const body = await response.json();
  return body.success === true;
}

async function verifyEnterpriseRecaptchaToken({ token, remoteIp, userAgent }) {
  const siteKey = process.env.VITE_RECAPTCHA_SITE_KEY || '';

  if (!siteKey) {
    throw new Error(
      'reCAPTCHA Enterprise is enabled but VITE_RECAPTCHA_SITE_KEY is not configured'
    );
  }

  const event = {
    token,
    siteKey
  };

  if (userAgent) {
    event.userAgent = userAgent;
  }

  if (remoteIp) {
    event.userIpAddress = remoteIp;
  }

  const response = await fetch(getEnterpriseAssessmentUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({ event })
  });

  if (!response.ok) {
    throw new Error(
      `reCAPTCHA Enterprise assessment failed with status ${response.status}`
    );
  }

  const body = await response.json();
  return body.tokenProperties?.valid === true;
}

async function verifyRecaptchaToken({ token, remoteIp, userAgent }) {
  if (!isRecaptchaEnabled()) {
    return true;
  }

  if (!token) {
    return false;
  }

  const provider = getRecaptchaProvider();

  if (provider === RECAPTCHA_PROVIDER_ENTERPRISE) {
    return verifyEnterpriseRecaptchaToken({ token, remoteIp, userAgent });
  }

  if (provider === RECAPTCHA_PROVIDER_CLASSIC) {
    return verifyClassicRecaptchaToken({ token, remoteIp });
  }

  throw new Error(`Unsupported reCAPTCHA provider: ${provider}`);
}

const recaptchaService = {
  verifyRecaptchaToken,
  verifyClassicRecaptchaToken,
  verifyEnterpriseRecaptchaToken
};

export {
  verifyClassicRecaptchaToken,
  verifyEnterpriseRecaptchaToken,
  verifyRecaptchaToken
};
export default recaptchaService;
