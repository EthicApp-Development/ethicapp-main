// The password strength rule. auth-backend is the only place that decides
// whether a password is strong enough: every route that sets a password
// checks it here, and the frontends (auth-backend's forms and the
// management console) read the limits from GET /api/auth/password-policy to
// build their live checklists instead of repeating them.

export const PASSWORD_MIN_LENGTH = 10;

// Characters other than ASCII letters and digits count as symbols.
export const PASSWORD_MIN_SYMBOLS = 2;

const SYMBOL_PATTERN = /[^a-zA-Z0-9]/g;

export function countPasswordSymbols(password) {
  return (String(password ?? '').match(SYMBOL_PATTERN) || []).length;
}

export function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return false;
  }

  return countPasswordSymbols(password) >= PASSWORD_MIN_SYMBOLS;
}

// The limits, as the public policy endpoint returns them.
export function getPasswordPolicy() {
  return {
    minLength: PASSWORD_MIN_LENGTH,
    minSymbols: PASSWORD_MIN_SYMBOLS
  };
}
