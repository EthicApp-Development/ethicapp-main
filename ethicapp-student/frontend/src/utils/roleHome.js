// Where a signed-in session belongs, by role. Mirrors getPostLoginRedirect() in
// auth-backend/routes/auth.routes.js: students stay in this app, professors go to
// the teacher app and administrators to the management console.

const ROLE_HOMES = Object.freeze({
  P: '/home',
  S: '/mng'
});

/**
 * @param {unknown} role Session role reported by GET /student/api/session.
 * @returns {string | null} The home to leave for, or null to stay in the student app.
 */
export function homeForRole(role) {
  return typeof role === 'string' && Object.hasOwn(ROLE_HOMES, role) ? ROLE_HOMES[role] : null;
}

/**
 * @param {{ isAuthenticated?: boolean, role?: unknown } | null | undefined} session
 * @returns {string | null} The home of a signed-in non-student session, otherwise null.
 */
export function nonStudentHome(session) {
  return session?.isAuthenticated ? homeForRole(session.role) : null;
}
