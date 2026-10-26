import { verifyRecaptchaToken } from './recaptcha.service.js';
import {
  listAdminPasskeysWithAuthBackend,
  verifyAdminPasskeyWithAuthBackend,
  verifyAdminPasswordWithAuthBackend
} from './authBackend.service.js';

// Error bodies of a refused confirmation. The frontend maps these values to
// translated messages, so they are part of the API contract.
export const SENSITIVE_ACTION_ERRORS = Object.freeze({
  passkeyRequired: 'PASSKEY_REQUIRED',
  invalidPasskey: 'Invalid administrator passkey',
  invalidPassword: 'Invalid administrator password',
  invalidRecaptcha: 'Invalid recaptcha token'
});

function isClientError(error) {
  return Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;
}

// Step-up confirmation for sensitive console actions. The request body
// carries either `passkey_assertion` (a WebAuthn assertion for the signed-in
// administrator) or `admin_password` plus `recaptcha_token`. An administrator
// with registered passkeys must use one; the password fallback is refused.
//
// verify(req, res) resolves to true when the action may proceed. Otherwise it
// has already answered the request and resolves to false:
// - 401 PASSKEY_REQUIRED when passkeys exist and no assertion was sent;
// - 401 for a passkey or password that auth-backend rejects;
// - 400 for a reCAPTCHA token that fails verification.
export function createSensitiveActionVerifier({
  verifyRecaptchaTokenService = verifyRecaptchaToken,
  listAdminPasskeysService = listAdminPasskeysWithAuthBackend,
  verifyAdminPasswordService = verifyAdminPasswordWithAuthBackend,
  verifyAdminPasskeyService = verifyAdminPasskeyWithAuthBackend
} = {}) {
  async function verifyPasskey(req, assertion) {
    try {
      return await verifyAdminPasskeyService({
        assertion,
        cookie: req.headers.cookie,
        language: req.headers['accept-language'],
        ...(req.headers.origin ? { origin: req.headers.origin } : {})
      });
    } catch (error) {
      // auth-backend answers 4xx for an expired challenge or an assertion
      // it rejects; anything else is an infrastructure failure.
      if (isClientError(error)) {
        return false;
      }
      throw error;
    }
  }

  return async function verifySensitiveAction(req, res) {
    const body = req.body || {};

    if (body.passkey_assertion) {
      if (!(await verifyPasskey(req, body.passkey_assertion))) {
        res.status(401).json({ error: SENSITIVE_ACTION_ERRORS.invalidPasskey });
        return false;
      }

      return true;
    }

    const passkeysResult = await listAdminPasskeysService({
      cookie: req.headers.cookie,
      language: req.headers['accept-language']
    });

    if ((passkeysResult?.passkeys || []).length > 0) {
      res.status(401).json({ error: SENSITIVE_ACTION_ERRORS.passkeyRequired });
      return false;
    }

    const isHuman = await verifyRecaptchaTokenService({
      token: String(body.recaptcha_token || ''),
      remoteIp: req.ip,
      userAgent: req.get('user-agent') || ''
    });

    if (!isHuman) {
      res.status(400).json({ error: SENSITIVE_ACTION_ERRORS.invalidRecaptcha });
      return false;
    }

    const isAdminPasswordValid = await verifyAdminPasswordService({
      password: String(body.admin_password || ''),
      cookie: req.headers.cookie,
      language: req.headers['accept-language']
    });

    if (!isAdminPasswordValid) {
      res.status(401).json({ error: SENSITIVE_ACTION_ERRORS.invalidPassword });
      return false;
    }

    return true;
  };
}
