/**
 * Who may advance an activity's phases: a teacher (role P) who created the
 * activity's session and whose account is not anonymized. It is the rule with
 * which teacher-activity-writes.js opens and advances an activity (#905).
 * Starting the next phase checks it here before its transaction, so a
 * refusal answers as the other endpoints do, and again inside the
 * transaction, under lock (helpers/phase-start-helper.js, #906). The
 * dashboard's owner-only reads use it too: the students' pseudonym numbers
 * and a phase's groups with their letters (#897).
 *
 * An administrator impersonating the teacher passes: impersonation signs the
 * session in as the teacher, with role P (controllers/users/impersonation.js).
 *
 * The checks send the error response themselves and resolve to null when the
 * request must stop:
 * - 401 without a signed-in user, 403 for any role other than P;
 * - 404 when the session (or the phase) does not exist;
 * - 403 when it exists but the requester does not own its session, or the
 *   account is anonymized.
 *
 * The check is a read, not a lock.
 */
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "./auth-helper.js";

// $1 session id, $2 requester id. One row when the session exists.
export const SESSION_OWNERSHIP_SQL = `
    SELECT s.id AS session_id,
           COALESCE(s.creator = requester.id, false) AS owned
    FROM sessions AS s
    LEFT JOIN users AS requester
        ON requester.id = $2
       AND requester.anonymized_at IS NULL
    WHERE s.id = $1
`;

// $1 phase id, $2 requester id. One row when the phase exists.
export const PHASE_OWNERSHIP_SQL = `
    SELECT st.id AS phase_id,
           st.sesid AS session_id,
           COALESCE(s.creator = requester.id, false) AS owned
    FROM stages AS st
    LEFT JOIN sessions AS s
        ON s.id = st.sesid
    LEFT JOIN users AS requester
        ON requester.id = $2
       AND requester.anonymized_at IS NULL
    WHERE st.id = $1
`;

function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

const NOT_FOUND = "Session not found.";
const PHASE_NOT_FOUND = "Phase not found.";
const DENIED = "Access denied. User is not authorized for this activity.";

/**
 * Lets the request through only for the owner of session `sessionId`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} sessionId - The session id from the route.
 * @returns {Promise<{sessionId: number}|null>} null once a response was sent.
 */
export async function requireSessionOwner(req, res, sessionId) {
    if (!requireRole(req, res, "P")) {
        return null;
    }

    const id = positiveInteger(sessionId);
    if (id === null) {
        res.status(404).json({ error: NOT_FOUND });
        return null;
    }

    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       SESSION_OWNERSHIP_SQL,
        sqlParams: [
            rpg2.param("plain", id),
            rpg2.param("plain", req.session.uid),
        ],
    });

    if (rows.length === 0) {
        res.status(404).json({ error: NOT_FOUND });
        return null;
    }

    if (rows[0].owned !== true) {
        res.status(403).json({ error: DENIED });
        return null;
    }

    return { sessionId: Number(rows[0].session_id) };
}

/**
 * Lets the request through only for the owner of the session of phase
 * `phaseId`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} phaseId - The phase id from the route.
 * @returns {Promise<{phaseId: number, sessionId: number}|null>} null once a
 *          response was sent.
 */
export async function requirePhaseOwner(req, res, phaseId) {
    if (!requireRole(req, res, "P")) {
        return null;
    }

    const id = positiveInteger(phaseId);
    if (id === null) {
        res.status(404).json({ error: PHASE_NOT_FOUND });
        return null;
    }

    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       PHASE_OWNERSHIP_SQL,
        sqlParams: [
            rpg2.param("plain", id),
            rpg2.param("plain", req.session.uid),
        ],
    });

    if (rows.length === 0) {
        res.status(404).json({ error: PHASE_NOT_FOUND });
        return null;
    }

    if (rows[0].owned !== true) {
        res.status(403).json({ error: DENIED });
        return null;
    }

    return { phaseId: Number(rows[0].phase_id), sessionId: Number(rows[0].session_id) };
}
