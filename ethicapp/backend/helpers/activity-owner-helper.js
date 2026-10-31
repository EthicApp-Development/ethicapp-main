/**
 * Who may advance an activity's phases: a teacher (role P) who created the
 * activity's session and whose account is not anonymized. It is the rule with
 * which teacher-activity-writes.js opens and advances an activity (#905).
 * Starting the next phase checks it here before its transaction, so a
 * refusal answers as the other endpoints do, and again inside the
 * transaction, under lock (helpers/phase-start-helper.js, #906).
 *
 * The check sends the error response itself and resolves to null when the
 * request must stop:
 * - 401 without a signed-in user, 403 for any role other than P;
 * - 404 when the session does not exist;
 * - 403 when it exists but the requester does not own it, or the account is
 *   anonymized.
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

function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

const NOT_FOUND = "Session not found.";

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
        res.status(403).json({ error: "Access denied. User is not authorized for this activity." });
        return null;
    }

    return { sessionId: Number(rows[0].session_id) };
}
