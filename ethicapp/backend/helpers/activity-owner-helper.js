/**
 * Who may build or advance an activity's phases: a teacher (role P) who
 * created the activity's session and whose account is not anonymized. It is
 * the rule with which teacher-activity-writes.js opens and advances an
 * activity, checked here before the endpoints that build a phase write
 * anything (#905).
 *
 * Each check sends the error response itself and resolves to null when the
 * request must stop:
 * - 401 without a signed-in user, 403 for any role other than P;
 * - 404 when the session or phase does not exist;
 * - 403 when it exists but the requester does not own it, or the account is
 *   anonymized.
 *
 * The check is a read, not a lock. The writes that follow it on these legacy
 * endpoints are separate statements, so an account forgotten between the
 * check and the write is not caught here; TRANSITION_SESSION_SQL still is.
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
    SELECT s.id AS session_id,
           COALESCE(s.creator = requester.id, false) AS owned
    FROM stages AS st
    INNER JOIN sessions AS s
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

async function requireOwner(req, res, { id, sql, notFound }) {
    if (!requireRole(req, res, "P")) {
        return null;
    }

    const resourceId = positiveInteger(id);
    if (resourceId === null) {
        res.status(404).json({ error: notFound });
        return null;
    }

    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql,
        sqlParams: [
            rpg2.param("plain", resourceId),
            rpg2.param("plain", req.session.uid),
        ],
    });

    if (rows.length === 0) {
        res.status(404).json({ error: notFound });
        return null;
    }

    if (rows[0].owned !== true) {
        res.status(403).json({ error: "Access denied. User is not authorized for this activity." });
        return null;
    }

    return { resourceId, sessionId: Number(rows[0].session_id) };
}

/**
 * Lets the request through only for the owner of session `sessionId`.
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} sessionId - The session id from the route.
 * @returns {Promise<{sessionId: number}|null>} null once a response was sent.
 */
export async function requireSessionOwner(req, res, sessionId) {
    const owner = await requireOwner(req, res, {
        id:       sessionId,
        sql:      SESSION_OWNERSHIP_SQL,
        notFound: "Session not found.",
    });
    return owner && { sessionId: owner.sessionId };
}

/**
 * Lets the request through only for the owner of the session that phase
 * `phaseId` belongs to (`stages.sesid`).
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} phaseId - The phase (stage) id from the route.
 * @returns {Promise<{phaseId: number, sessionId: number}|null>} null once a
 *   response was sent.
 */
export async function requirePhaseOwner(req, res, phaseId) {
    const owner = await requireOwner(req, res, {
        id:       phaseId,
        sql:      PHASE_OWNERSHIP_SQL,
        notFound: "Phase not found.",
    });
    return owner && { phaseId: owner.resourceId, sessionId: owner.sessionId };
}
