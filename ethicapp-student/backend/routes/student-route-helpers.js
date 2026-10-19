import studentMessages from '../i18n/messages/student-messages.js';
import { translateMessage } from '../i18n/locale.js';

export function t(req, key) {
  return translateMessage(req, key, studentMessages);
}

/**
 * Responds 401/403 unless the request belongs to an authenticated student.
 * @returns {number | null} Student user id, or null when a response was sent.
 */
export function ensureStudentSession(req, res) {
  const uid = Number(req.session?.uid);
  const role = req.session?.role;

  if (!Number.isInteger(uid) || uid <= 0) {
    res.status(401).json({ error: t(req, 'unauthenticated') });
    return null;
  }

  if (role !== 'A') {
    res.status(403).json({ error: t(req, 'unauthorizedStudent') });
    return null;
  }

  return uid;
}
