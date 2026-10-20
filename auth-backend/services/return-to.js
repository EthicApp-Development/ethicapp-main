// Validation of the optional returnTo target that sends a user back to what
// they were doing after signing in (for example, a session join interrupted
// by an expired session). Only internal paths from an allowlist are accepted,
// so returnTo can never become an open redirect.

const INTERNAL_ORIGIN = 'http://ethicapp.invalid';
const MAX_RETURN_TO_LENGTH = 512;

// Each prefix lists the roles allowed to land there.
const RETURN_TO_ALLOWLIST = Object.freeze([
  Object.freeze({ prefix: '/student/', roles: Object.freeze(['A']) })
]);

const DEFAULT_REDIRECT_BY_ROLE = Object.freeze({
  A: '/student',
  P: '/home',
  S: '/mng'
});

/**
 * Normalizes a returnTo value, or returns null when it is not an internal
 * path under the allowlist. Rejects absolute and protocol-relative URLs,
 * backslashes, control characters and paths that leave the allowlisted prefix
 * once dot segments (including encoded ones) are resolved.
 * @param {unknown} value
 * @returns {string|null} Path, query and fragment of the target.
 */
export function sanitizeReturnTo(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) {
    return null;
  }

  // eslint-disable-next-line no-control-regex
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  // Encoded slashes, backslashes and dots: NGINX decodes them before resolving
  // dot segments, so they could reach a path outside the allowlisted prefix.
  if (/%(?:2f|5c|2e)/i.test(value)) {
    return null;
  }

  let target;

  try {
    target = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return null;
  }

  if (target.origin !== INTERNAL_ORIGIN) {
    return null;
  }

  const normalized = `${target.pathname}${target.search}${target.hash}`;
  return RETURN_TO_ALLOWLIST.some(({ prefix }) => target.pathname.startsWith(prefix)) ? normalized : null;
}

export function getPostLoginRedirect(role) {
  return DEFAULT_REDIRECT_BY_ROLE[role] ?? '/login';
}

/**
 * Where to send a user after signing in: a valid returnTo within the user's
 * role scope, or the role-based destination otherwise.
 * @param {string} role
 * @param {unknown} returnTo
 */
export function resolvePostLoginRedirect(role, returnTo) {
  const target = sanitizeReturnTo(returnTo);

  if (!target) {
    return getPostLoginRedirect(role);
  }

  const allowedForRole = RETURN_TO_ALLOWLIST.some(({ prefix, roles }) => (
    target.startsWith(prefix) && roles.includes(role)
  ));

  return allowedForRole ? target : getPostLoginRedirect(role);
}

/**
 * Appends a valid returnTo to an auth link (sign-in, reset or confirmation),
 * dropping it when it is not valid.
 * @param {string} url Absolute or root-relative URL.
 * @param {unknown} returnTo
 */
export function appendReturnTo(url, returnTo) {
  const target = sanitizeReturnTo(returnTo);

  if (!target) {
    return url;
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}returnTo=${encodeURIComponent(target)}`;
}
