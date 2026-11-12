/**
 * The phase clock of an activity (epic #1105, #1111): what the teacher's
 * dashboard and the student app need to count the current phase down, read
 * from the database on every call. `GET /activities/:id/clock` answers it,
 * and the `onPhaseClock` socket event carries it after a change
 * (helpers/phase-clock-notifier.js).
 *
 * The clock is never cached. It stays out of the student activity descriptor
 * that Redis caches (helpers/student-activity-state-helper.js), since "+1 min"
 * (#1112) moves a deadline without any other change to the activity.
 *
 * Shape, the same for the teacher (role P) and the students (role A):
 *
 *     {
 *       sessionId:   number,
 *       timeMode:    "none" | "soft" | "hard",
 *       finished:    boolean,
 *       phaseId:     number | null,
 *       phaseNumber: number | null,
 *       startedAt:   string | null,   // ISO 8601
 *       endsAt:      string | null,   // ISO 8601
 *       isLastPhase: boolean | null,
 *       serverNow:   string,          // ISO 8601, the database's clock
 *     }
 *
 * Clients compute `offset = Date.parse(serverNow) - Date.now()` when they
 * receive it, and count down locally to `endsAt`.
 *
 * Edge cases:
 * - no phase started yet: `phaseId`, `phaseNumber`, `startedAt`, `endsAt`
 *   and `isLastPhase` are null, and `finished` is false;
 * - a finished activity: `finished` is true and the phase fields are null,
 *   since finishing leaves the session without a current phase
 *   (helpers/activity-finish-helper.js);
 * - a phase without a duration, or any phase of an activity whose time mode
 *   is "none": `endsAt` is null, and the phase runs untimed;
 * - a phase started before V45: `startedAt` is null too;
 * - a deadline that has passed: `endsAt` is earlier than `serverNow`. In soft
 *   mode the teacher's count goes on as negative time; in hard mode the
 *   deadline runner (#1113) starts the next phase, except on the last phase
 *   (`isLastPhase`), which a deadline never finishes.
 *
 * `isLastPhase` says whether the design has no phase after the current one,
 * the rule with which starting the next phase answers `no_next_phase`
 * (helpers/phase-start-helper.js).
 *
 * `serverNow` comes from clock_timestamp(), the database's time when the row
 * is read, rather than now(), which inside a transaction would be the time
 * the transaction began. The deadlines come from the same database clock.
 */
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { sessionTimeMode, TIME_MODES } from "./session-time-mode.js";

const FINISHED = getStatusCode("finished");

// $1 session id. One row when the session exists. The design is the one of
// the activity launched in the session, as phase-start-helper.js reads it; a
// session without an activity or a design without phases has a phase count
// of zero.
export const PHASE_CLOCK_SQL = `
    SELECT s.id AS session_id,
           s.time_mode,
           s.status,
           st.id AS phase_id,
           st.number AS phase_number,
           st.started_at,
           st.ends_at,
           (
               SELECT CASE
                          WHEN jsonb_typeof(d.design -> 'phases') = 'array'
                              THEN jsonb_array_length(d.design -> 'phases')
                          ELSE 0
                      END
               FROM activity AS a
               INNER JOIN designs AS d
                   ON a.design = d.id
               WHERE a.session = s.id
               ORDER BY a.id DESC
               LIMIT 1
           ) AS design_phase_count,
           clock_timestamp() AS server_now
    FROM sessions AS s
    LEFT JOIN stages AS st
        ON st.id = s.current_stage
    WHERE s.id = $1
`;

function isoTime(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * The clock of a PHASE_CLOCK_SQL row.
 *
 * @param {Object} row
 * @returns {Object} The clock, in the shape documented above.
 */
export function phaseClockFromRow(row) {
    const timeMode = sessionTimeMode(row);
    const finished = Number(row.status) === FINISHED;
    const hasPhase = !finished && row.phase_id !== null && row.phase_id !== undefined;
    const phaseNumber = hasPhase ? Number(row.phase_number) : null;

    return {
        sessionId:   Number(row.session_id),
        timeMode,
        finished,
        phaseId:     hasPhase ? Number(row.phase_id) : null,
        phaseNumber,
        startedAt:   hasPhase ? isoTime(row.started_at) : null,
        endsAt:      hasPhase && timeMode !== TIME_MODES.NONE ? isoTime(row.ends_at) : null,
        isLastPhase: hasPhase ? phaseNumber >= Number(row.design_phase_count ?? 0) : null,
        serverNow:   isoTime(row.server_now),
    };
}

async function defaultQuery(sql, params) {
    return rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql,
        sqlParams: params.map(value => rpg2.param("plain", value)),
    });
}

/**
 * Reads the clock of session `sessionId`. It checks no access: callers check
 * it first (controllers/activities/phase-clock.js), or send it only to the
 * session's socket rooms, which are guarded.
 *
 * @param {number|string} sessionId
 * @param {Object} [dependencies]
 * @param {(sql: string, params: unknown[]) => Promise<Object[]>} [dependencies.query]
 * @returns {Promise<Object|null>} The clock, or null for an unknown session.
 */
export async function readPhaseClock(sessionId, { query = defaultQuery } = {}) {
    const rows = await query(PHASE_CLOCK_SQL, [Number(sessionId)]);
    return rows.length === 0 ? null : phaseClockFromRow(rows[0]);
}
