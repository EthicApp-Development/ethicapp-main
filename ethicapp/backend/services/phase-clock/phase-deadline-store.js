import { getStatusCode } from "../../../common/modules/session-status.js";
import { CLAIM_DUE_DEADLINE_SQL } from "../../helpers/phase-start-helper.js";
import { poolQuery } from "../external-service-jobs.service.js";

/**
 * The statements of the phase deadline runner (epic #1105, #1113) on the
 * phase clock columns of V45. Every statement looks for deadlines that are
 * set, due by the database's clock and not yet handled, which the partial
 * index `idx_stages_pending_deadline` holds; once handled, a row leaves it.
 *
 * A deadline is enforced when its phase is the current phase of a hard-mode
 * activity in progress: the runner starts the next phase. Every other due
 * deadline is unenforced (a soft-mode phase, whose teacher moves on by hand,
 * the last phase of an activity finished before it, a phase of an activity
 * without a time mode, which should have none), and is only marked handled,
 * so the index does not keep it forever.
 */

const IN_PROGRESS = getStatusCode("in_progress");

// $1 in_progress status code, $2 how many, $3 phase ids left out (those the
// runner is backing off). The enforced deadlines, earliest first.
export const DUE_ENFORCED_DEADLINES_SQL = `
    SELECT s.id AS session_id,
           s.creator AS teacher_id,
           st.id AS phase_id,
           st.number AS phase_number
    FROM stages AS st
    INNER JOIN sessions AS s
        ON s.id = st.sesid
       AND s.current_stage = st.id
    WHERE st.ends_at IS NOT NULL
      AND st.deadline_handled_at IS NULL
      AND st.ends_at <= now()
      AND s.time_mode = 'hard'
      AND s.status = $1
      AND NOT (st.id = ANY($3::integer[]))
    ORDER BY st.ends_at, st.id
    LIMIT $2
`;

// $1 in_progress status code, $2 how many. Marks the unenforced due
// deadlines handled, without starting any phase. A row locked by a
// concurrent change (a teacher's start, "+1 min") is left for the next run,
// and its conditions are checked again on the row's latest version, so a
// deadline moved later meanwhile is not marked. A session that the
// statement's snapshot sees as not hard, not in progress or on another phase
// cannot become so for this phase again, so an enforced deadline is never
// marked here.
export const SETTLE_UNENFORCED_DEADLINES_SQL = `
    WITH unenforced AS (
        SELECT st.id
        FROM stages AS st
        INNER JOIN sessions AS s
            ON s.id = st.sesid
        WHERE st.ends_at IS NOT NULL
          AND st.deadline_handled_at IS NULL
          AND st.ends_at <= now()
          AND (
              s.time_mode <> 'hard'
              OR s.status IS DISTINCT FROM $1
              OR s.current_stage IS DISTINCT FROM st.id
          )
        ORDER BY st.ends_at, st.id
        LIMIT $2
        FOR UPDATE OF st SKIP LOCKED
    )
    UPDATE stages AS st
    SET deadline_handled_at = now()
    FROM unenforced
    WHERE st.id = unenforced.id
    RETURNING st.id
`;

// $1 phase id. The claim of a deadline start (phase-start-helper.js), for an
// outcome after which the runner gives the deadline up: still due and not
// handled, or nothing is written.
export const MARK_DEADLINE_HANDLED_SQL = CLAIM_DUE_DEADLINE_SQL;

/**
 * @param {Object} [options]
 * @param {(sql: string, params: unknown[]) => Promise<object[]>} [options.dbQuery]
 *     Runs one statement and resolves to its rows.
 */
export function createPhaseDeadlineStore({ dbQuery = poolQuery } = {}) {
    /**
     * The due deadlines the runner enforces, earliest first.
     * @param {{ limit: number, excludePhaseIds?: number[] }} options
     * @returns {Promise<Array<{ sessionId: number, teacherId: number,
     *     phaseId: number, phaseNumber: number }>>}
     */
    async function listDueEnforced({ limit, excludePhaseIds = [] }) {
        const rows = await dbQuery(DUE_ENFORCED_DEADLINES_SQL,
            [IN_PROGRESS, limit, excludePhaseIds]);
        return rows.map(row => ({
            sessionId:   Number(row.session_id),
            teacherId:   Number(row.teacher_id),
            phaseId:     Number(row.phase_id),
            phaseNumber: Number(row.phase_number),
        }));
    }

    /**
     * Marks up to `limit` unenforced due deadlines handled.
     * @returns {Promise<number>} How many were marked.
     */
    async function settleUnenforced({ limit }) {
        const rows = await dbQuery(SETTLE_UNENFORCED_DEADLINES_SQL, [IN_PROGRESS, limit]);
        return rows.length;
    }

    /**
     * Marks a phase's deadline handled while it is still due and not handled.
     * @returns {Promise<boolean>} Whether it was marked.
     */
    async function markHandled(phaseId) {
        const rows = await dbQuery(MARK_DEADLINE_HANDLED_SQL, [phaseId]);
        return rows.length > 0;
    }

    return { listDueEnforced, settleUnenforced, markHandled };
}
