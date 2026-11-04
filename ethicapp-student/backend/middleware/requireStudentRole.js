import studentMessages from '../i18n/messages/student-messages.js';
import { translateMessage } from '../i18n/locale.js';

/**
 * Lets only student sessions (role A) through, the way management-console's
 * requireManagementRole lets only role S through. NGINX already sends
 * unauthenticated requests to the login page, so the 401 only covers requests
 * that reach the backend without an identity.
 */
export default function requireStudentRole(req, res, next) {
  const uid = Number(req.session?.uid);

  if (!Number.isInteger(uid) || uid <= 0) {
    return res.status(401).json({ error: translateMessage(req, 'unauthenticated', studentMessages) });
  }

  if (req.session.role !== 'A') {
    return res.status(403).json({ error: translateMessage(req, 'unauthorizedStudent', studentMessages) });
  }

  return next();
}
