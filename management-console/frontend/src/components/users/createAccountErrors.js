// How a refused "Create account" (#1170) is reported. The backend passes
// auth-backend's refusals through as { error: <code>, message: <localized
// text> }; the form stays as typed, for the administrator to correct it.

// Refusals of the typed fields: auth-backend's own message, the same one
// users get at sign-up, so the console never restates the rules.
const FIELD_REFUSALS = new Set([
  'REQUIRED_FIELDS_MISSING',
  'PASSWORDS_DO_NOT_MATCH',
  'WEAK_PASSWORD',
  'INVALID_GENDER',
  'INVALID_EMAIL',
  'INVALID_ROLE'
]);

// Refusals with the console's own text.
const CONSOLE_REFUSALS = Object.freeze({
  EMAIL_ALREADY_REGISTERED: 'pages.userCreate.errors.emailAlreadyRegistered',
  PRIVACY_NOTICE_NOT_CONFIRMED: 'pages.userCreate.errors.privacyNoticeNotConfirmed'
});

function codeOf(error) {
  return error?.code ?? error?.message;
}

// The message to show above the form.
export function describeCreateAccountError(error, t) {
  const code = codeOf(error);
  const serverMessage = typeof error?.body?.message === 'string' ? error.body.message : '';

  if (FIELD_REFUSALS.has(code) && serverMessage) {
    return serverMessage;
  }

  if (CONSOLE_REFUSALS[code]) {
    return t(CONSOLE_REFUSALS[code]);
  }

  return t('pages.userCreate.error');
}
