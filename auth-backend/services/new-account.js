import { isStrongPassword } from './password-policy.js';

// What a new local account needs, shared by self sign-up (POST /register)
// and an administrator creating an account from the management console
// (POST /admin/users, #1170), so the two cannot drift.

const GENDERS = new Set(['F', 'M', 'O']);

// Refusals of the fields, as machine-readable codes, with the key of their
// localized message in i18n/messages/auth-messages.js.
export const NEW_ACCOUNT_REFUSALS = Object.freeze({
  PASSWORDS_DO_NOT_MATCH: 'passwordsDoNotMatch',
  WEAK_PASSWORD: 'weakPassword',
  INVALID_GENDER: 'invalidGender'
});

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The account fields of a request body: the names and gender trimmed, the
 * email trimmed and lowercased, and the passwords as sent.
 *
 * @param {object} [body] - The request body.
 * @returns {{firstname: string, lastname: string, gender: string,
 *     email: string, password: string, passwordConfirmation: string}}
 */
export function readNewAccountFields(body = {}) {
  return {
    firstname: trimmed(body.firstname),
    lastname: trimmed(body.lastname),
    gender: trimmed(body.gender),
    email: trimmed(body.email).toLowerCase(),
    password: typeof body.password === 'string' ? body.password : '',
    passwordConfirmation: typeof body.password_confirmation === 'string' ? body.password_confirmation : ''
  };
}

/**
 * Whether every field is present.
 *
 * @param {ReturnType<typeof readNewAccountFields>} fields
 * @returns {boolean}
 */
export function hasRequiredNewAccountFields(fields) {
  return Boolean(
    fields.firstname &&
    fields.lastname &&
    fields.gender &&
    fields.email &&
    fields.password &&
    fields.passwordConfirmation
  );
}

/**
 * The first refusal of present fields, in the order sign-up has always
 * checked them, or null when the account may be created.
 *
 * @param {ReturnType<typeof readNewAccountFields>} fields
 * @returns {keyof NEW_ACCOUNT_REFUSALS | null}
 */
export function newAccountFieldsRefusal(fields) {
  if (fields.password !== fields.passwordConfirmation) {
    return 'PASSWORDS_DO_NOT_MATCH';
  }

  if (!isStrongPassword(fields.password)) {
    return 'WEAK_PASSWORD';
  }

  if (!GENDERS.has(fields.gender)) {
    return 'INVALID_GENDER';
  }

  return null;
}

/**
 * The account's `name` column: first and last name.
 *
 * @param {ReturnType<typeof readNewAccountFields>} fields
 * @returns {string}
 */
export function newAccountFullName(fields) {
  return [fields.firstname, fields.lastname].filter(Boolean).join(' ').trim();
}

// users_mail_lower_unique (V42) refuses two emails that differ only in letter
// case. The other names come from schemas before V42.
const USER_MAIL_UNIQUE_CONSTRAINTS = new Set([
  'users_mail_lower_unique',
  'users_mail_unique',
  'users_mail_key'
]);

/**
 * Whether a database error is the unique violation of the users email.
 *
 * @param {Error & {code?: string, constraint?: string, detail?: string}} err
 * @returns {boolean}
 */
export function isUniqueMailViolation(err) {
  if (!err || err.code !== '23505') {
    return false;
  }

  return (
    USER_MAIL_UNIQUE_CONSTRAINTS.has(err.constraint) ||
    (typeof err.detail === 'string' &&
      (err.detail.includes('(mail)=') || err.detail.includes('(lower(mail))=')))
  );
}
