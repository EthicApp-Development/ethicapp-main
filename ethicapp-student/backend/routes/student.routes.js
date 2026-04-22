import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

function ensureStudentSession(req, res) {
  const uid = Number(req.session?.uid);
  const role = req.session?.role;

  if (!Number.isInteger(uid) || uid <= 0) {
    res.status(401).json({ error: 'Usuario no autenticado' });
    return null;
  }

  if (role !== 'A') {
    res.status(403).json({ error: 'Usuario sin permisos de estudiante' });
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
                s.current_stage,
                (
                    s.id in (SELECT sesid FROM teams)
                ) AS grouped,
                (
                    SELECT count(*)
                    FROM report_pair
                    WHERE sesid = s.id
                ) AS paired,
                sr.stime
            FROM sessions AS s
            LEFT OUTER JOIN status_record AS sr
              ON sr.sesid = s.id
             AND s.status = sr.status,
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

router.post('/sessions/join', async (req, res, next) => {
  const uid = ensureStudentSession(req, res);

  if (!uid) {
    return;
  }

  const code = req.params?.code ?? req.body?.code;
  const { device } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Código de sesión requerido' });
  }

  try {
    const result = await query(
      `
        INSERT INTO sesusers(uid, sesid, device)
        SELECT $1::int AS uid,
               id,
               $2 AS device
        FROM sessions
        WHERE code = $3
          AND NOT EXISTS (
              SELECT su.sesid
              FROM sesusers AS su,
                   sessions AS s
              WHERE su.uid = $1
                AND s.code = $3
                AND su.sesid = s.id
          )
          AND NOT EXISTS (
              SELECT st.id
              FROM stages AS st,
                   sessions AS ss
              WHERE st.sesid = ss.id
                AND ss.code = $3
                AND st.type = 'team'
          )
        RETURNING sesid
      `,
      [uid, device ?? null, code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'No fue posible unirse a la sesión con el código entregado'
      });
    }

    return res.status(201).json({
      sesid: result.rows[0].sesid
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
