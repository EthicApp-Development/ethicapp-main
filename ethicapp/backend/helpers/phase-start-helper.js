/**
 * Starting an activity's next phase (#906), its first phase included, in one
 * transaction on a dedicated client:
 *
 * 1. the teacher's account row is locked FOR SHARE while it is not
 *    anonymized, then the session FOR UPDATE, in the order of
 *    teacher-activity-writes.js, so that forgetting the teacher (#877) and
 *    starting a phase cannot deadlock, and a start waiting for a forgetting
 *    writes nothing once it commits;
 * 2. the session must be the teacher's, not finished, and at phase
 *    `expectedPhaseNumber` (0 before the first phase); a second request for
 *    the same phase waits for the first and then finds the session moved on;
 * 3. a start by the deadline runner (`trigger: "deadline"`, #1110) goes on
 *    only when the activity's time mode is hard and the current phase's
 *    deadline has passed and was not yet handled, which it marks handled;
 * 4. the design's phase after the current one is read from the database, not
 *    from the request;
 * 5. a start by the teacher marks the current phase's deadline, if it has
 *    one, as handled, so that the runner never acts on it;
 * 6. phases numbered above the current one, left by a start that failed
 *    halfway before this transaction existed, are removed with their items
 *    and groups;
 * 7. the phase, its items and, for a team phase, its groups are inserted;
 *    the phase records its start, what started it and, in an activity with
 *    a time mode, its duration and deadline (epic #1105), all from the
 *    database's clock;
 * 8. the session moves to the new phase (TRANSITION_SESSION_SQL).
 *
 * Any failure rolls all of it back. Only after the commit are the students'
 * cached descriptor dropped, the students notified and the phase hooks
 * dispatched, as the old phase transition endpoint did. Their failures are
 * logged and never undo the phase.
 *
 * Times come from the database's now(), the start of the transaction, so a
 * phase's start, its deadline and the handling of the deadline it leaves
 * share one instant, and no Node clock is involved.
 */
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { studentNotifications } from "../config/socket.config.js";
import { dispatchPhaseHook as defaultDispatchPhaseHook } from "./external-service-dispatch.js";
import { shouldDispatchActivityStarted } from "./activity-lifecycle-helper.js";
import { TRANSITION_SESSION_SQL } from "./teacher-activity-writes.js";
import { phaseItemWriters } from "./phase-items-helper.js";
import { groupingAlgorithms, insertGroups } from "./groups-helper.js";
import { isValidPhaseDuration } from "./phase-duration.js";

const IN_PROGRESS = getStatusCode("in_progress");
const FINISHED = getStatusCode("finished");

// What starts a phase: the teacher's request, or the deadline runner (#1113)
// once the current phase's deadline passed in a hard-mode activity.
export const PHASE_START_TRIGGERS = Object.freeze(["teacher", "deadline"]);

// The time modes (sessions.time_mode, V45) in which a phase with a duration
// gets a deadline. 'none' gives no phase a clock.
const TIMED_MODES = new Set(["soft", "hard"]);

// $1 teacher id. No row when the account is anonymized.
export const LOCK_TEACHER_SQL = `
    SELECT id
    FROM users
    WHERE id = $1
      AND anonymized_at IS NULL
    FOR SHARE
`;

// $1 session id. Without joins, so that a request that waited for the lock
// reads the session as the other transaction left it.
export const LOCK_SESSION_SQL = `
    SELECT id, creator, status, current_stage, time_mode
    FROM sessions
    WHERE id = $1
    FOR UPDATE
`;

// $1 phase id.
export const PHASE_NUMBER_SQL = `
    SELECT number
    FROM stages
    WHERE id = $1
`;

// $1 session id. The design of the activity launched in the session.
export const ACTIVITY_DESIGN_SQL = `
    SELECT d.design
    FROM activity AS a
    INNER JOIN designs AS d
        ON a.design = d.id
    WHERE a.session = $1
    ORDER BY a.id DESC
    LIMIT 1
`;

// $1 session id, $2 number of its current phase. Phases never started.
export const LEFTOVER_PHASES_SQL = `
    SELECT id
    FROM stages
    WHERE sesid = $1
      AND number > $2
    ORDER BY id
`;

// $1 phase ids, in this order.
export const DELETE_LEFTOVER_PHASES_SQL = [
    `DELETE FROM teamusers AS tu
     USING teams AS t
     WHERE tu.tmid = t.id
       AND t.stageid = ANY($1::integer[])`,
    "DELETE FROM teams WHERE stageid = ANY($1::integer[])",
    "DELETE FROM differential WHERE stageid = ANY($1::integer[])",
    "DELETE FROM actors WHERE stageid = ANY($1::integer[])",
    "DELETE FROM stages WHERE id = ANY($1::integer[])",
];

// $1 phase id. A deadline runner's start: marks the current phase's deadline
// handled when it has passed and was not handled yet. No row otherwise. A
// concurrent "+1 min" that moved ends_at is seen, since PostgreSQL checks the
// conditions again on the row's latest version.
export const CLAIM_DUE_DEADLINE_SQL = `
    UPDATE stages
    SET deadline_handled_at = now()
    WHERE id = $1
      AND ends_at <= now()
      AND deadline_handled_at IS NULL
    RETURNING id
`;

// $1 phase id. A teacher's start: the deadline of the phase it leaves, if it
// has one, is handled, so the deadline runner never acts on it.
export const MARK_DEADLINE_HANDLED_SQL = `
    UPDATE stages
    SET deadline_handled_at = now()
    WHERE id = $1
      AND ends_at IS NOT NULL
      AND deadline_handled_at IS NULL
`;

// $1 number, $2 type (the phase's mode), $3 anon, $4 chat, $5 session id,
// $6 prev_ans, $7 question, $8 grouping, $9 start_trigger, $10
// duration_seconds, or null for a phase without a deadline. started_at and
// ends_at come from the database's clock.
export const INSERT_PHASE_SQL = `
    INSERT INTO stages (
        number, type, anon, chat, sesid, prev_ans, question, grouping,
        started_at, start_trigger, duration_seconds, ends_at
    )
    VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        now(), $9, $10, now() + $10::integer * interval '1 second'
    )
    RETURNING id
`;

/**
 * The `stages` columns of a design's phase, as the dashboard used to send
 * them: the mode as the type, the previous phases whose answers are shown as
 * JSON, and `size:algorithm` as the grouping of a team phase.
 *
 * `durationSeconds` is the phase's `durationMinutes` (#1107) in seconds when
 * the activity has a time mode (`soft` or `hard`), and null otherwise: for
 * `none`, for a phase without a duration, and for a duration that is not a
 * valid one, which saving a design refuses (helpers/phase-duration.js): such
 * a phase runs untimed rather than failing to start.
 *
 * @param {Object} phase A phase of the design (`designs.design.phases[]`).
 * @param {string} [timeMode] The session's `time_mode`.
 */
export function phaseColumns(phase, timeMode = "none") {
    const timed = TIMED_MODES.has(timeMode) && isValidPhaseDuration(phase.durationMinutes);
    const grouping = phase.mode === "team"
        ? `${phase.stdntAmount}:${phase.grouping_algorithm}`
        : null;
    return {
        type:            phase.mode,
        anon:            phase.anonymous || false,
        chat:            phase.chat || false,
        prevAns:         JSON.stringify(phase.prevPhasesResponse) || null,
        question:        phase.q_text || null,
        grouping,
        durationSeconds: timed ? phase.durationMinutes * 60 : null,
    };
}

/**
 * Why the design's phase cannot be started, or null when it can.
 */
export function phaseDesignProblem(designType, phase) {
    if (!phaseItemWriters[designType]) {
        return `Unsupported design type: ${designType}`;
    }
    if (!phase || typeof phase !== "object" || typeof phase.mode !== "string" || !phase.mode) {
        return "The design's phase has no mode.";
    }
    if (phase.mode !== "team") {
        return null;
    }
    if (!Object.hasOwn(groupingAlgorithms, phase.grouping_algorithm)) {
        return `Unsupported grouping algorithm: ${phase.grouping_algorithm}`;
    }
    const groupSize = Number(phase.stdntAmount);
    const validSize = Number.isSafeInteger(groupSize) && groupSize > 0;
    if (phase.grouping_algorithm === "random" && !validSize) {
        return "The design's team phase has no valid group size.";
    }
    return null;
}

async function defaultConnect() {
    const db = await rpg2.getDBInstance(config.dbconnString);
    return db.connect();
}

// Loaded on first use: the descriptor cache module opens a Redis connection
// when it is imported, which tests importing this module avoid.
async function defaultInvalidateStudentDescriptor(sessionId) {
    const descriptorCache = await import("./student-activity-state-helper.js");
    await descriptorCache.invalidateCachedStudentActivityDescriptor(sessionId);
}

function defaultNotifyStudents(sessionId) {
    studentNotifications.phaseTransition(sessionId);
}

/**
 * @param {Object} [dependencies]
 * @param {() => Promise<{ query: Function, release: Function }>} [dependencies.connect]
 *        Checks out a `pg` client for the transaction.
 * @param {(sessionId: number) => Promise<void>} [dependencies.invalidateStudentDescriptor]
 * @param {(sessionId: number) => void} [dependencies.notifyStudents]
 * @param {(hookName: string, context: Object) => Promise<unknown>} [dependencies.dispatchPhaseHook]
 * @param {() => number} [dependencies.random] For the random grouping.
 * @param {{ warn: Function, error: Function }} [dependencies.logger]
 */
export function createPhaseStarter({
    connect = defaultConnect,
    invalidateStudentDescriptor = defaultInvalidateStudentDescriptor,
    notifyStudents = defaultNotifyStudents,
    dispatchPhaseHook = defaultDispatchPhaseHook,
    random = Math.random,
    logger = console,
} = {}) {
    async function removeLeftoverPhases(client, sessionId, currentPhaseNumber) {
        const { rows } = await client.query(LEFTOVER_PHASES_SQL, [sessionId, currentPhaseNumber]);
        if (rows.length === 0) {
            return;
        }
        const ids = rows.map(row => Number(row.id));
        logger.warn(`[phase-start] Removing phases ${ids.join(", ")} of session ${sessionId}, `
            + "which were never started.");
        for (const sql of DELETE_LEFTOVER_PHASES_SQL) {
            await client.query(sql, [ids]);
        }
    }

    async function formGroups(client, { phase, phaseId, sessionId, currentPhaseNumber }) {
        const algorithm = groupingAlgorithms[phase.grouping_algorithm];
        const groups = await algorithm(client, {
            sessionId,
            groupSize: Number(phase.stdntAmount),
            currentPhaseNumber,
            random,
        });
        return insertGroups(client, { sessionId, phaseId, groups });
    }

    // Rolled back: nothing was written.
    const refuse = outcome => ({ outcome, commit: false });

    async function startInTransaction(client, {
        sessionId, teacherId, expectedPhaseNumber, trigger,
    }) {
        const teacher = await client.query(LOCK_TEACHER_SQL, [teacherId]);
        if (teacher.rows.length === 0) {
            return refuse({ status: "forbidden" });
        }

        const { rows: [session] } = await client.query(LOCK_SESSION_SQL, [sessionId]);
        if (!session) {
            return refuse({ status: "not_found" });
        }
        if (Number(session.creator) !== teacherId) {
            return refuse({ status: "forbidden" });
        }
        if (Number(session.status) === FINISHED) {
            return refuse({ status: "finished" });
        }

        const previousPhaseId = session.current_stage === null
            ? null
            : Number(session.current_stage);
        let currentPhaseNumber = 0;
        if (previousPhaseId !== null) {
            const { rows: [current] } = await client.query(PHASE_NUMBER_SQL, [previousPhaseId]);
            currentPhaseNumber = Number(current.number);
        }
        if (currentPhaseNumber !== expectedPhaseNumber) {
            return refuse({ status: "stale", currentPhaseNumber });
        }

        const byDeadline = trigger === "deadline";
        if (byDeadline) {
            if (session.time_mode !== "hard" || previousPhaseId === null) {
                return refuse({ status: "not_due", currentPhaseNumber });
            }
            const claim = await client.query(CLAIM_DUE_DEADLINE_SQL, [previousPhaseId]);
            if (claim.rows.length === 0) {
                return refuse({ status: "not_due", currentPhaseNumber });
            }
        }
        // Past this point a deadline runner's start has claimed the deadline,
        // which stays handled whatever comes next: a refusal below is final,
        // and only a thrown error undoes the claim, so the runner tries again.
        const settle = outcome => ({ outcome, commit: byDeadline });

        const { rows: [activity] } = await client.query(ACTIVITY_DESIGN_SQL, [sessionId]);
        if (!activity?.design) {
            return settle({ status: "not_launched" });
        }
        const design = activity.design;
        const phases = Array.isArray(design.phases) ? design.phases : [];
        if (currentPhaseNumber >= phases.length) {
            return settle({ status: "no_next_phase", currentPhaseNumber });
        }

        const phase = phases[currentPhaseNumber];
        const problem = phaseDesignProblem(design.type, phase);
        if (problem) {
            return settle({ status: "invalid_design", problem });
        }

        if (!byDeadline && previousPhaseId !== null) {
            await client.query(MARK_DEADLINE_HANDLED_SQL, [previousPhaseId]);
        }

        await removeLeftoverPhases(client, sessionId, currentPhaseNumber);

        const number = currentPhaseNumber + 1;
        const columns = phaseColumns(phase, session.time_mode);
        const { rows: [inserted] } = await client.query(INSERT_PHASE_SQL, [
            number,
            columns.type,
            columns.anon,
            columns.chat,
            sessionId,
            columns.prevAns,
            columns.question,
            columns.grouping,
            trigger,
            columns.durationSeconds,
        ]);
        const phaseId = Number(inserted.id);

        await phaseItemWriters[design.type](client, { phase, phaseId, sessionId, teacherId });

        if (phase.mode === "team") {
            await formGroups(client, { phase, phaseId, sessionId, currentPhaseNumber });
        }

        const moved = await client.query(TRANSITION_SESSION_SQL,
            [IN_PROGRESS, phaseId, sessionId, teacherId]);
        if (moved.rows.length !== 1) {
            throw new Error(`Session ${sessionId} could not be moved to phase ${phaseId}.`);
        }

        return {
            outcome: {
                status:         "started",
                phase:          { id: phaseId, number },
                trigger,
                previousPhaseId,
                previousStatus: session.status === null ? null : Number(session.status),
            },
            commit: true,
        };
    }

    async function dispatchHook(hookName, context) {
        try {
            await dispatchPhaseHook(hookName, context);
        } catch (error) {
            logger.error(`[external-services] Error dispatching ${hookName} hook.`, error);
        }
    }

    async function dispatchPhaseHooks(context, previousPhaseId, phaseId) {
        if (previousPhaseId && previousPhaseId !== phaseId) {
            await dispatchHook("phase-ended", { ...context, phaseId: previousPhaseId });
        }
        await dispatchHook("phase-started", { ...context, phaseId });
    }

    // What the old phase transition endpoint did after its update. The
    // descriptor is dropped before the students are told to reload it. The
    // hooks are not awaited, as before: they call external services, and the
    // teacher's request does not wait for them. `hooks` settles once they
    // are dispatched, and never rejects.
    async function announce(sessionId, { phase, previousPhaseId, previousStatus }) {
        try {
            await invalidateStudentDescriptor(sessionId);
        } catch (error) {
            logger.error("[phase-start] Could not drop the cached student descriptor of "
                + `session ${sessionId}.`, error);
        }

        try {
            notifyStudents(sessionId);
        } catch (error) {
            logger.error(`[phase-start] Could not notify the students of session ${sessionId}.`,
                error);
        }

        const context = { sessionId, startedPhaseId: phase.id, endedPhaseId: previousPhaseId };
        const hooks = [dispatchPhaseHooks(context, previousPhaseId, phase.id)];
        // Only when the activity enters in_progress, with its first phase.
        if (shouldDispatchActivityStarted(previousStatus)) {
            hooks.push(dispatchHook("activity-started", { ...context, phaseId: phase.id }));
        }
        return { hooks: Promise.all(hooks).then(() => undefined) };
    }

    /**
     * Resolves once the transaction ended and, for a started phase, the
     * students were told; `hooks` settles when the phase hooks are dispatched.
     *
     * `trigger` says who starts the phase, and is recorded as the new phase's
     * `start_trigger`:
     *
     * - `"teacher"` (the default, and always the route's): the teacher's
     *   request. Starting the next phase marks the current phase's deadline,
     *   if it has one, as handled.
     * - `"deadline"`: the deadline runner (#1113), on behalf of the session's
     *   creator (`teacherId`). The start goes on only when the activity's time
     *   mode is `hard` and the current phase's `ends_at` has passed, by the
     *   database's clock, with `deadline_handled_at` still null; otherwise the
     *   outcome is `not_due` and nothing is written. Once that holds, the
     *   current phase's deadline is marked handled and stays so whatever the
     *   outcome: `started`, and also `no_next_phase` (the last phase, which a
     *   deadline never finishes), `invalid_design` and `not_launched`, which
     *   no retry can change. Only a thrown error rolls the mark back.
     *
     * Every other outcome writes nothing.
     *
     * @param {{ sessionId: number, teacherId: number, expectedPhaseNumber: number,
     *           trigger?: "teacher" | "deadline" }} request
     * @returns {Promise<
     *     { status: "started", phase: { id: number, number: number },
     *       trigger: "teacher" | "deadline", previousPhaseId: number|null,
     *       previousStatus: number|null, hooks: Promise<void> }
     *   | { status: "stale" | "no_next_phase" | "not_due", currentPhaseNumber: number }
     *   | { status: "invalid_design", problem: string }
     *   | { status: "forbidden" | "not_found" | "finished" | "not_launched" }>}
     */
    async function startNextPhase({
        sessionId, teacherId, expectedPhaseNumber, trigger = "teacher",
    }) {
        if (!PHASE_START_TRIGGERS.includes(trigger)) {
            throw new TypeError(`Unknown phase start trigger: ${trigger}`);
        }
        const request = {
            sessionId:           Number(sessionId),
            teacherId:           Number(teacherId),
            expectedPhaseNumber: Number(expectedPhaseNumber),
            trigger,
        };

        const client = await connect();
        let result;
        try {
            await client.query("BEGIN");
            const { outcome, commit } = await startInTransaction(client, request);
            await client.query(commit ? "COMMIT" : "ROLLBACK");
            result = outcome;
        } catch (error) {
            await client.query("ROLLBACK").catch((rollbackError) => {
                logger.error("[phase-start] Error rolling back the start of a phase:",
                    rollbackError);
            });
            throw error;
        } finally {
            client.release();
        }

        if (result.status === "started") {
            const { hooks } = await announce(request.sessionId, result);
            return { ...result, hooks };
        }
        return result;
    }

    return { startNextPhase };
}

const defaultPhaseStarter = createPhaseStarter();

export default defaultPhaseStarter;
