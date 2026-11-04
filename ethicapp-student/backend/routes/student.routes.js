import { Router } from 'express';
import { query } from '../config/database.js';
import { createSessionJoinRouter } from './session-join.routes.js';
import { ensureStudentSession } from './student-route-helpers.js';
import { requireStudentRole } from '../middleware/index.js';

const router = Router();

// Answers for every authenticated role: the frontend reads the role to send
// professors and administrators to their own home.
router.get('/session', (req, res) => {
  res.json({
    uid: req.session?.uid ?? null,
    role: req.session?.role ?? null,
    isAuthenticated: req.session?.uid != null,
    impersonating: !!req.session?.impersonating
  });
});

// Every route below requires a student session.
router.use(requireStudentRole);

router.get('/sessions', async (req, res, next) => {
  const uid = ensureStudentSession(req, res);

  if (!uid) {
    return;
  }

  try {
    const result = await query(
      `
        SELECT *
        FROM (
            SELECT DISTINCT s.id,
                s.name,
                s.descr,
                s.status,
                s.type,
                s.time,
                s.code,
                s.options,
                s.archived,
                s.current_stage,
                (
                    s.id in (SELECT sesid FROM teams)
                ) AS grouped,
                0 AS paired,
                NULL::timestamp AS stime
            FROM sessions AS s,
            sesusers AS su,
            users AS u
            WHERE su.uid = $1
              AND (OPTIONS like 'X%') IS NOT TRUE
              AND u.id = su.uid
              AND su.sesid = s.id
        ) AS v
        ORDER BY v.time DESC
      `,
      [uid]
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.use(createSessionJoinRouter());

export default router;
