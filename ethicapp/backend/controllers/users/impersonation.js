import express from 'express';
import pass from '../../helpers/compat-helper.js';
import { getDBInstance } from '../../db/rest-pg-2.js';

const router = express.Router();

function isAuthorizedSuperAdmin(req) {
  const canonicalRole = req.session?.authRole || req.session?.role;
  return canonicalRole === 'S';
}

router.post('/api/admin/impersonation/professor/:id', async (req, res) => {
  try {
    if (!req.session?.uid) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (!isAuthorizedSuperAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const professorId = Number(req.params.id);

    if (!Number.isInteger(professorId) || professorId <= 0) {
      return res.status(400).json({ error: 'Invalid target user' });
    }

    const db = await getDBInstance(pass.dbcon);
    const targetResult = await db.query(
      `
        SELECT id, role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [professorId]
    );

    if (targetResult.rowCount === 0) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    const targetUser = targetResult.rows[0];

    if (targetUser.role !== 'P') {
      return res.status(400).json({ error: 'Target user must be a professor' });
    }

    req.session.uid = targetUser.id;
    req.session.role = 'P';
    req.session.impersonating = true;

    if (!req.session.authUid) {
      req.session.authUid = Number(req.get('X-User-Id')) || null;
    }

    if (!req.session.authRole) {
      req.session.authRole = req.get('X-User-Role') || null;
    }

    return req.session.save((error) => {
      if (error) {
        return res.status(500).json({ error: 'Unable to start impersonation' });
      }

      return res.status(200).json({
        ok: true,
        redirectTo: '/home'
      });
    });
  } catch (error) {
    console.error('IMPERSONATION START ERROR:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/api/admin/impersonation/stop', (req, res) => {
  try {
    if (!req.session?.uid) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (!isAuthorizedSuperAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!req.session.impersonating) {
      return res.status(200).json({ ok: true, redirectTo: '/home' });
    }

    req.session.uid = req.session.authUid;
    req.session.role = req.session.authRole;
    req.session.impersonating = false;

    return req.session.save((error) => {
      if (error) {
        return res.status(500).json({ error: 'Unable to stop impersonation' });
      }

      return res.status(200).json({ ok: true, redirectTo: '/home' });
    });
  } catch (error) {
    console.error('IMPERSONATION STOP ERROR:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
