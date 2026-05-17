import { Router } from 'express';
import { query } from '../config/database.js';
import studentMessages from '../i18n/messages/student-messages.js';
import { translateMessage } from '../i18n/locale.js';

const router = Router();

function t(req, key) {
  return translateMessage(req, key, studentMessages);
}


function ensureStudentSession(req, res) {
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

router.get('/session', (req, res) => {
  res.json({
    uid: req.session?.uid ?? null,
    role: req.session?.role ?? null,
    isAuthenticated: req.session?.uid != null,
    impersonating: !!req.session?.impersonating
  });
});

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
                s.current_phase_id,
                (
                    s.id in (SELECT session_id FROM groups)
                ) AS grouped,
                0 AS paired,
                NULL::timestamp AS stime
            FROM sessions AS s,
            sessions_users AS su,
            users AS u
            WHERE su.user_id = $1
              AND (OPTIONS like 'X%') IS NOT TRUE
              AND u.id = su.user_id
              AND su.session_id = s.id
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

router.post('/sessions/join', async (req, res, next) => {
  const uid = ensureStudentSession(req, res);

  if (!uid) {
    return;
  }

  const code = (req.body?.code ?? '').toLowerCase();
  const { device } = req.body;

  if (!code) {
    return res.status(400).json({ error: t(req, 'sessionCodeRequired') });
  }

  console.log('[join] payload', {
    uid,
    code,
    device: device ?? null
  });

  try {
    const existingMembership = await query(
      `
        SELECT s.id AS sesid
        FROM sessions_users AS su
        JOIN sessions AS s
          ON s.id = su.session_id
        WHERE su.user_id = $1
          AND s.code = $2
        LIMIT 1
      `,
      [uid, code]
    );

    if (existingMembership.rowCount > 0) {
      return res.status(200).json({
        sesid: existingMembership.rows[0].sesid,
        alreadyJoined: true
      });
    }

    const result = await query(
      `
        INSERT INTO sessions_users(user_id, session_id, device)
        SELECT $1::int AS user_id,
               id AS session_id,
               $2 AS device
        FROM sessions
        WHERE code = $3
          AND NOT EXISTS (
              SELECT su.session_id
              FROM sessions_users AS su,
                   sessions AS s
              WHERE su.user_id = $1
                AND s.code = $3
                AND su.session_id = s.id
          )
          AND NOT EXISTS (
              SELECT st.id
              FROM phases AS st,
                   sessions AS ss
              WHERE st.session_id = ss.id
                AND ss.code = $3
                AND st.phase_type = 'team'
          )
        RETURNING session_id AS sesid
      `,
      [uid, device ?? null, code]
    );

    if (result.rowCount === 0) {
      console.log('[join] no row inserted', { uid, code, device: device ?? null });
      return res.status(404).json({
        error: t(req, 'joinSessionUnavailable')
      });
    }

    return res.status(201).json({
      sesid: result.rows[0].sesid,
      alreadyJoined: false
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
