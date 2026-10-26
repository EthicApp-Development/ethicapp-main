// Step-up confirmation for sensitive console actions, without React: how the
// request payload is built and how a refused confirmation is reported. The
// backend contract lives in management-console/backend/services/
// sensitive-action.service.js.

export const CONFIRMATION_METHODS = Object.freeze({
  loading: 'loading',
  password: 'password',
  passkey: 'passkey'
});

const ERROR_KEY_PREFIX = 'sensitiveAction.errors';

// Backend `error` values of a refused confirmation, mapped to translations.
const STEP_UP_ERROR_KEYS = Object.freeze({
  PASSKEY_REQUIRED: `${ERROR_KEY_PREFIX}.passkeyRequired`,
  'Invalid administrator passkey': `${ERROR_KEY_PREFIX}.invalidPasskey`,
  'Invalid administrator password': `${ERROR_KEY_PREFIX}.invalidPassword`,
  'Invalid recaptcha token': `${ERROR_KEY_PREFIX}.invalidRecaptcha`
});

export const PASSKEY_FAILED_KEY = `${ERROR_KEY_PREFIX}.passkeyFailed`;

function errorCodeOf(error) {
  return error?.code ?? error?.message;
}

// Translation key for an error that refuses the confirmation itself, or null
// for any other error (a validation error of the action, for example).
export function stepUpErrorKey(error) {
  return STEP_UP_ERROR_KEYS[errorCodeOf(error)] ?? null;
}

export function passkeysSupported(globalObject = globalThis) {
  return Boolean(globalObject?.PublicKeyCredential);
}

// Fields the confirmation adds to the action's request body.
export async function buildStepUpPayload({ method, password, recaptchaToken, getPasskeyAssertion }) {
  if (method === CONFIRMATION_METHODS.passkey) {
    return { passkey_assertion: await getPasskeyAssertion() };
  }

  return { admin_password: password, recaptcha_token: recaptchaToken };
}

// One confirmation attempt: build the payload, then run the action with it.
// Resolves to
// - { status: 'done', result } when the action succeeded;
// - { status: 'retry', errorKey, method } when the confirmation was refused
//   or the passkey ceremony did not complete; `method` is the method to use
//   next (PASSKEY_REQUIRED switches to the passkey).
// Rejects with any other error of the action, which the caller reports.
export async function attemptConfirmation({ method, password, recaptchaToken, getPasskeyAssertion, action }) {
  let stepUp;
  try {
    stepUp = await buildStepUpPayload({ method, password, recaptchaToken, getPasskeyAssertion });
  } catch (error) {
    if (errorCodeOf(error) === 'SESSION_EXPIRED') {
      throw error;
    }
    // The browser prompt was dismissed or timed out, or the challenge could
    // not be obtained: nothing was sent, so the administrator may try again.
    return { status: 'retry', errorKey: PASSKEY_FAILED_KEY, method };
  }

  try {
    return { status: 'done', result: await action(stepUp) };
  } catch (error) {
    const errorKey = stepUpErrorKey(error);
    if (!errorKey) {
      throw error;
    }

    const nextMethod = errorCodeOf(error) === 'PASSKEY_REQUIRED' ? CONFIRMATION_METHODS.passkey : method;
    return { status: 'retry', errorKey, method: nextMethod };
  }
}

// Whether the confirm button can submit. Without a configured site key the
// reCAPTCHA widget is not shown, so no token can be required.
export function canSubmitConfirmation({ method, busy, password, recaptchaToken, recaptchaRequired, passkeySupport }) {
  if (busy || method === CONFIRMATION_METHODS.loading) {
    return false;
  }

  if (method === CONFIRMATION_METHODS.passkey) {
    return passkeySupport;
  }

  return password !== '' && (!recaptchaRequired || recaptchaToken !== '');
}
