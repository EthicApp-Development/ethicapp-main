// Carries the optional returnTo target (where to go after signing in) across
// the auth pages. The API validates it against an allowlist; the client only
// drops values that cannot be an internal path.

export function readReturnTo(searchParams) {
  const value = searchParams?.get('returnTo') ?? '';
  return value.startsWith('/') && !value.startsWith('//') ? value : '';
}

/**
 * @param {string} path Auth route, optionally with a query string.
 * @param {string} returnTo
 */
export function withReturnTo(path, returnTo) {
  if (!returnTo) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}
