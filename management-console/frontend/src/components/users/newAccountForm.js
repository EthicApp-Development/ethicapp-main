import { checkPassword } from '../common/passwordPolicy.js';

// The values of the "Create account" form (#1170) and when it may be
// submitted. auth-backend checks every field again; these checks only keep
// the button disabled until the form is complete.

const TEXT_FIELDS = Object.freeze(['firstname', 'lastname', 'email', 'password', 'password_confirmation']);
const ROLES = new Set(['A', 'P']);
const GENDERS = new Set(['F', 'M', 'O']);

// An empty form, with the account's language set to the administrator's.
export function emptyNewAccount(locale) {
  return {
    firstname: '',
    lastname: '',
    email: '',
    gender: '',
    role: '',
    preferred_locale: locale === 'es_CL' ? 'es_CL' : 'en_US',
    password: '',
    password_confirmation: '',
    privacy_notice_confirmed: false
  };
}

// Whether every field is filled in, the passwords match and meet the policy
// (when it is known), and the privacy notice is confirmed.
export function canSubmitNewAccount(values, policy) {
  if (TEXT_FIELDS.some((name) => String(values[name] || '').trim() === '')) {
    return false;
  }

  if (!ROLES.has(values.role) || !GENDERS.has(values.gender)) {
    return false;
  }

  if (values.password !== values.password_confirmation) {
    return false;
  }

  const checks = checkPassword(values.password, policy);
  if (checks && !checks.satisfied) {
    return false;
  }

  return values.privacy_notice_confirmed === true;
}
