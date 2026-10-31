// Live checklist of the password strength rule. auth-backend owns the rule
// and refuses a weak password with its own message; the limits come from
// its public endpoint, so the console never repeats them.

// The policy if it is well formed, otherwise null.
export function normalizePasswordPolicy(value) {
  const minLength = Number(value?.minLength);
  const minSymbols = Number(value?.minSymbols);

  if (!Number.isInteger(minLength) || minLength < 1 || !Number.isInteger(minSymbols) || minSymbols < 0) {
    return null;
  }

  return { minLength, minSymbols };
}

// Characters other than ASCII letters and digits count as symbols, as in
// auth-backend's services/password-policy.js.
function countSymbols(password) {
  return (password.match(/[^a-zA-Z0-9]/g) || []).length;
}

// Which limits the password meets, or null while the policy is unknown.
export function checkPassword(password, policy) {
  if (!policy) {
    return null;
  }

  const value = String(password || '');
  const minLength = value.length >= policy.minLength;
  const minSymbols = countSymbols(value) >= policy.minSymbols;

  return { minLength, minSymbols, satisfied: minLength && minSymbols };
}
