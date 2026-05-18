import crypto from 'node:crypto';

const CSRF_SESSION_KEY = 'csrfToken';
const CSRF_HEADER_NAME = 'x-csrf-token';
const INTERNAL_SERVICE_HEADER_NAME = 'x-internal-service-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getRequestCsrfToken(req) {
  return String(req.get(CSRF_HEADER_NAME) || req.body?._csrf || '').trim();
}

function hasValidInternalServiceToken(req) {
  const expectedToken = getInternalServiceToken();
  const providedToken = String(req.get(INTERNAL_SERVICE_HEADER_NAME) || '').trim();

  return Boolean(expectedToken && providedToken && safeEqual(providedToken, expectedToken));
}

export function ensureCsrfToken(req) {
  if (!req.session) {
    throw new Error('Session middleware is required before CSRF protection');
  }

  if (!req.session[CSRF_SESSION_KEY]) {
    req.session[CSRF_SESSION_KEY] = crypto.randomBytes(32).toString('base64url');
  }

  return req.session[CSRF_SESSION_KEY];
}

export function csrfTokenHandler(req, res) {
  return res.status(200).json({
    csrfToken: ensureCsrfToken(req)
  });
}

export function csrfProtection(req, res, next) {
  if (!MUTATING_METHODS.has(req.method) || hasValidInternalServiceToken(req)) {
    return next();
  }

  let expectedToken;

  try {
    expectedToken = ensureCsrfToken(req);
  } catch (error) {
    return next(error);
  }

  const providedToken = getRequestCsrfToken(req);

  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return res.status(403).json({
      error: 'Invalid CSRF token'
    });
  }

  return next();
}
