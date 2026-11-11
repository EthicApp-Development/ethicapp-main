/**
 * "+1 min" (epic #1105, #1112): the teacher adds one minute to the current
 * phase's deadline, in soft and hard mode, and a double click adds it once.
 *
 * One conditional statement (EXTEND_PHASE_DEADLINE_SQL) moves `stages.ends_at`
 * one minute later only while all of this holds:
 *
 * - the session is the teacher's and is not finished;
 * - its time mode is not "none";
 * - the phase belongs to it and is its current phase;
 * - the phase has a deadline, and that deadline is still the one the teacher
 *   saw (`expectedEndsAt`), compared to the millisecond, the precision of the
 *   clock's ISO 8601 times (helpers/phase-clock.js). Two requests sent with
 *   the same `expectedEndsAt` add one minute between them: the second one
 *   finds the deadline moved;
 * - in hard mode, the deadline has not passed unhandled: the deadline runner
 *   (#1113) is about to act on it, and its decision stands.
 *
 * The extension is added to the later of the deadline and the database's
 * now() (decision of 2026-11-11), in both modes ("+1 min" works in both,
 * decision of 2026-11-04). Before the deadline it moves 09:30 left to 10:30
 * left; after it, in soft mode past 00:00 or on a hard-mode last phase whose
 * deadline the runner handled, the clock restarts at one full minute for
 * everyone. `expectedEndsAt` is still compared with the deadline as it was.
 *
 * The same statement sets `deadline_handled_at` back to null, so that the
 * runner handles the new deadline: a hard-mode last phase whose deadline the
 * runner already handled (the teacher got the notice) gets a new one, and a
 * soft-mode deadline that the runner marked handled is due again.
 *
 * The statement locks the session FOR SHARE before it updates the phase, the
 * order in which a phase start locks them (helpers/phase-start-helper.js).
 * A phase start and a finish lock the session FOR UPDATE, so an extension
 * either commits before them, and the start sees the new deadline, or waits
 * for them and then finds that the phase is no longer current or that the
 * activity is finished. Two extensions share the session lock and meet on the
 * phase's row, where PostgreSQL checks the deadline again on the row's latest
 * version.
 *
 * When nothing is updated, EXTENSION_STATE_SQL reads why, after the
 * statement: what it reads may be later than what the statement saw, and the
 * refusal describes the activity as it is now.
 */
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { TIME_MODES } from "./session-time-mode.js";

const FINISHED = getStatusCode("finished");

// The only extension a request may ask for (#1112).
export const EXTENSION_MINUTES = 1;

// $1 session id, $2 phase id, $3 teacher id, $4 minutes, $5 expected
// deadline (ISO 8601, millisecond precision), $6 the finished status. One row,
// the phase's new deadline, when the deadline moved; none otherwise.
export const EXTEND_PHASE_DEADLINE_SQL = `
    WITH session AS (
        SELECT id, current_stage, time_mode
        FROM sessions
        WHERE id = $1
          AND creator = $3
          AND status IS DISTINCT FROM $6
          AND time_mode <> 'none'
        FOR SHARE
    )
    UPDATE stages AS st
    SET ends_at = GREATEST(st.ends_at, now()) + $4::integer * interval '1 minute',
        deadline_handled_at = NULL
    FROM session AS s
    WHERE st.id = $2
      AND st.sesid = s.id
      AND st.id = s.current_stage
      AND st.ends_at IS NOT NULL
      AND date_trunc('milliseconds', st.ends_at) = $5::timestamptz
      AND NOT (
          s.time_mode = 'hard'
          AND st.ends_at <= now()
          AND st.deadline_handled_at IS NULL
      )
    RETURNING st.id AS phase_id, st.ends_at
`;

// $1 session id, $2 phase id. One row when the session exists; the phase
// columns are null when the phase is not one of the session's.
export const EXTENSION_STATE_SQL = `
    SELECT s.creator,
           s.status,
           s.current_stage,
           s.time_mode,
           st.id AS phase_id,
           st.ends_at,
           st.deadline_handled_at,
           COALESCE(st.ends_at <= now(), false) AS deadline_passed
    FROM sessions AS s
    LEFT JOIN stages AS st
        ON st.id = $2
       AND st.sesid = s.id
    WHERE s.id = $1
`;

/**
 * Why an extension was refused, from an EXTENSION_STATE_SQL row, in this
 * order:
 *
 * - `not_found`: no session, or not the teacher's;
 * - `phase_not_found`: the phase is not one of the session's;
 * - `finished`: the activity is finished;
 * - `not_current`: the phase is not the session's current phase;
 * - `no_deadline`: the activity has no time mode, or the phase no deadline;
 * - `deadline_passed`: a hard-mode deadline that passed and was not handled;
 * - `deadline_changed`: the deadline is not the expected one any more.
 *
 * @param {Object|undefined} row
 * @param {{ teacherId: number, phaseId: number }} request
 * @returns {string}
 */
export function extensionRefusal(row, { teacherId, phaseId }) {
    if (!row || Number(row.creator) !== Number(teacherId)) {
        return "not_found";
    }
    if (row.phase_id === null || row.phase_id === undefined) {
        return "phase_not_found";
    }
    if (Number(row.status) === FINISHED) {
        return "finished";
    }
    if (row.current_stage === null || Number(row.current_stage) !== Number(phaseId)) {
        return "not_current";
    }
    if (row.time_mode === TIME_MODES.NONE || row.ends_at === null || row.ends_at === undefined) {
        return "no_deadline";
    }
    if (row.time_mode === TIME_MODES.HARD && row.deadline_passed === true
        && (row.deadline_handled_at === null || row.deadline_handled_at === undefined)) {
        return "deadline_passed";
    }
    return "deadline_changed";
}

async function defaultQuery(sql, params) {
    return rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql,
        sqlParams: params.map(value => rpg2.param("plain", value)),
    });
}

/**
 * Adds `minutes` to the deadline of phase `phaseId` of session `sessionId`,
 * or to the current time once the deadline has passed, for the session's
 * teacher `teacherId`, when the deadline is still `expectedEndsAt`.
 * Callers check the request first: the owner (requireSessionOwner) and the
 * values, `minutes` being EXTENSION_MINUTES and `expectedEndsAt` a valid
 * time.
 *
 * @param {{ sessionId: number, phaseId: number, teacherId: number,
 *           minutes: number, expectedEndsAt: string }} request
 * @param {Object} [dependencies]
 * @param {(sql: string, params: unknown[]) => Promise<Object[]>} [dependencies.query]
 * @returns {Promise<{ status: "extended", phaseId: number, endsAt: Date }
 *   | { status: "not_found" | "phase_not_found" | "finished" | "not_current"
 *       | "no_deadline" | "deadline_passed" | "deadline_changed" }>}
 */
export async function extendPhaseDeadline(
    { sessionId, phaseId, teacherId, minutes, expectedEndsAt },
    { query = defaultQuery } = {},
) {
    const ids = { sessionId: Number(sessionId), phaseId: Number(phaseId) };
    const rows = await query(EXTEND_PHASE_DEADLINE_SQL, [
        ids.sessionId,
        ids.phaseId,
        Number(teacherId),
        Number(minutes),
        new Date(expectedEndsAt).toISOString(),
        FINISHED,
    ]);
    if (rows.length > 0) {
        return {
            status:  "extended",
            phaseId: Number(rows[0].phase_id),
            endsAt:  rows[0].ends_at,
        };
    }

    const [state] = await query(EXTENSION_STATE_SQL, [ids.sessionId, ids.phaseId]);
    return { status: extensionRefusal(state, { teacherId, phaseId: ids.phaseId }) };
}
