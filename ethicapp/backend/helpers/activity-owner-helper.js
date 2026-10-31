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
 * - 401 without a signed-in user, 403 for any role other than P, checked
 *   before any lookup;
 * - 404 when the session or phase does not exist, and the same 404 when it
 *   exists but the requester does not own it or the account is anonymized,
 *   so the answer does not reveal that it exists (#923).
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

    // Another teacher's activity is answered as an unknown one (#923).
    if (rows.length === 0 || rows[0].owned !== true) {
        res.status(404).json({ error: notFound });
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

// --- Launching, and reading as a participant (#910) ------------------------
// The owner rule above also guards finishing and archiving an activity and
// reading its phases, responses, groups and statistics. Launching adds the
// design's check; the endpoints the student app calls let in a participant.
// These checks repeat the owner checks' steps instead of sharing a private
// function with them, so each reads on its own.

// $1 design id, $2 requester id. One row when the design exists.
export const DESIGN_LAUNCH_SQL = `
    SELECT d.id AS design_id,
           COALESCE(d.creator = $2, false) AS owned
    FROM designs AS d
    WHERE d.id = $1
`;

// $1 phase id, $2 requester id. One row when the phase exists. A participant
// is a user enrolled in the phase's session (sesusers), the rule of the
// socket rooms (sockets/socket-room-access.js).
export const PHASE_ACCESS_SQL = `
    SELECT st.id AS phase_id,
           s.id AS session_id,
           COALESCE(s.creator = requester.id, false) AS owned,
           EXISTS (
               SELECT 1
               FROM sesusers AS su
               WHERE su.sesid = s.id
                 AND su.uid = requester.id
           ) AS participant
    FROM stages AS st
    INNER JOIN sessions AS s
        ON s.id = st.sesid
    LEFT JOIN users AS requester
        ON requester.id = $2
       AND requester.anonymized_at IS NULL
    WHERE st.id = $1
`;

/**
 * Lets a teacher launch an activity with design `designId` only when the
 * design is theirs: launching locks the design, and only its creator may lock
 * it (PATCH /designs/:id/lock). A public design of another teacher is
 * imported first (POST /designs/:id/duplicate); the launch page offers only
 * the teacher's own designs. Run it after requireSessionOwner, which already
 * refuses an anonymized account.
 *
 * Answers 401 without a signed-in user, 403 for any role other than P, and
 * the same 404 for an unknown design and for another teacher's (#923).
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} designId - The design id from the request.
 * @returns {Promise<{designId: number}|null>} null once a response was sent.
 */
export async function requireLaunchableDesign(req, res, designId) {
    if (!requireRole(req, res, "P")) {
        return null;
    }

    const id = positiveInteger(designId);
    if (id === null) {
        res.status(404).json({ error: "Design not found." });
        return null;
    }

    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       DESIGN_LAUNCH_SQL,
        sqlParams: [
            rpg2.param("plain", id),
            rpg2.param("plain", req.session.uid),
        ],
    });

    if (rows.length === 0 || rows[0].owned !== true) {
        res.status(404).json({ error: "Design not found." });
        return null;
    }

    return { designId: id };
}

/**
 * Lets the request through for the owner of the session of phase `phaseId`
 * (role P, as requirePhaseOwner) or for a student (role A) enrolled in that
 * session, while the requester's account is not anonymized. With
 * `subjectUserId`, the user whose data the request asks for, a student passes
 * only for themselves; the owner may ask for anyone.
 *
 * Answers 401 without a signed-in user and 403 for any other role, before any
 * lookup. An unknown phase, a teacher who does not own the session, a student
 * who does not participate in it and a student asking for another user all
 * get the same 404, so the answer does not reveal that the phase exists
 * (#923).
 *
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {number|string} phaseId - The phase id from the route.
 * @param {{subjectUserId?: number|string}} [options]
 * @returns {Promise<{phaseId: number, sessionId: number}|null>} null once a
 *   response was sent.
 */
export async function requirePhaseOwnerOrParticipant(req, res, phaseId, { subjectUserId } = {}) {
    if (!requireRole(req, res, ["P", "A"])) {
        return null;
    }

    const id = positiveInteger(phaseId);
    const otherStudent = req.session.role === "A"
        && subjectUserId !== undefined
        && Number(subjectUserId) !== Number(req.session.uid);
    if (id === null || otherStudent) {
        res.status(404).json({ error: "Phase not found." });
        return null;
    }

    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       PHASE_ACCESS_SQL,
        sqlParams: [
            rpg2.param("plain", id),
            rpg2.param("plain", req.session.uid),
        ],
    });

    // A teacher passes only as the owner: the teacher's own enrolment in the
    // session (POST /sessions) does not make them a participant.
    const allowed = rows.length > 0 && (req.session.role === "P"
        ? rows[0].owned === true
        : rows[0].participant === true);
    if (!allowed) {
        res.status(404).json({ error: "Phase not found." });
        return null;
    }

    return { phaseId: id, sessionId: Number(rows[0].session_id) };
}
