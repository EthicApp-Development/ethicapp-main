// How a refused "Set password" (#889) is reported. The backend passes
// auth-backend's refusals through as { error: <code>, message: <localized
// text> }.

// Refusals of the typed password itself: the dialog opens again with
// auth-backend's own message (the same one users get at sign-up), so the
// console never restates the rule.
const PASSWORD_REFUSALS = new Set(['WEAK_PASSWORD', 'PASSWORDS_DO_NOT_MATCH', 'REQUIRED_FIELDS_MISSING']);

// Refusals of the account, with the console's own text. Those marked
// `changed` mean the account changed meanwhile: the page reloads it.
const ACCOUNT_REFUSALS = Object.freeze({
  ACCOUNT_CHANGED: { key: 'pages.userSetPassword.errors.accountChanged', changed: true },
  ACCOUNT_ANONYMIZED: { key: 'pages.userSetPassword.errors.accountAnonymized', changed: true },
  ROLE_NOT_ALLOWED: { key: 'pages.userSetPassword.errors.roleNotAllowed', changed: true },
  USER_NOT_FOUND: { key: 'pages.userSetPassword.errors.userNotFound', changed: true },
  NOT_LOCAL_ACCOUNT: { key: 'pages.userSetPassword.errors.notLocalAccount', changed: false },
  OWN_ACCOUNT: { key: 'pages.userSetPassword.errors.ownAccount', changed: false }
});

function codeOf(error) {
  return error?.code ?? error?.message;
}

// { retry: true, message } for a refusal of the password, shown in the
// dialog; otherwise { retry: false, message, changed } for the page.
export function describeSetPasswordError(error, t) {
  const code = codeOf(error);
  const serverMessage = typeof error?.body?.message === 'string' ? error.body.message : '';

  if (PASSWORD_REFUSALS.has(code)) {
    return { retry: true, message: serverMessage || t('pages.userSetPassword.error') };
  }

  const refusal = ACCOUNT_REFUSALS[code];
  if (refusal) {
    return { retry: false, message: t(refusal.key), changed: refusal.changed };
  }

  return { retry: false, message: t('pages.userSetPassword.error'), changed: false };
}
