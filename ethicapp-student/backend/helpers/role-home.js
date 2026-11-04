// Mirrors getPostLoginRedirect() in auth-backend/routes/auth.routes.js (its
// ROLE_HOMES table), which decides where each role lands after signing in.
// Keep both in sync.
const ROLE_HOMES = Object.freeze({
  A: '/student',
  P: '/home',
  S: '/mng'
});

/**
 * Home page of a role.
 * @param {string | null | undefined} role
 * @returns {string | null} Path of the role's home, or null for an unknown role.
 */
export function getRoleHome(role) {
  return Object.hasOwn(ROLE_HOMES, role) ? ROLE_HOMES[role] : null;
}
