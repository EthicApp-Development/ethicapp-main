/**
 * Whether a student may submit a response to the current phase of an
 * activity (`POST /activities/:id/response`, #927, epic #923), or to the
 * previous one just after an automatic advance (#1114).
 *
 * The route checks role A first. This policy then answers one request with
 * either the phase and task the response goes to, or one refusal with a
 * stable code the student app maps to a localized message:
 *
 * | Reason                                         | Status | Code                    |
 * |------------------------------------------------|--------|-------------------------|
 * | unknown session, student not enrolled in it,   | 404    | SESSION_NOT_FOUND       |
 * | or anonymized account                          |        |                         |
 * | the activity is finished, or archived          | 409    | ACTIVITY_FINISHED       |
 * | the activity has no current phase              | 409    | NO_ACTIVE_PHASE         |
 * | `phaseId` in the payload is not the current    | 409    | PHASE_CHANGED           |
 * | phase, nor the previous one within the grace   |        |                         |
 * | window below                                   |        |                         |
 * | the design type takes no responses here        | 400    | UNSUPPORTED_DESIGN_TYPE |
 * | the question or ranking item is not in the     | 400    | QUESTION_NOT_IN_PHASE   |
 * | phase the response goes to                     |        |                         |
 *
 * The checks run in that order. The first one reuses the participant rule of
 * the activity endpoints (isSessionParticipant), so a session the student is
 * not enrolled in is answered as an unknown one and its state is never read.
 * That refusal is also logged as a security event, with ids only.
 *
 * Grace window after an automatic advance (#1114, epic #1105). When the
 * deadline runner of a hard-mode activity started the current phase
 * (`start_trigger = 'deadline'`) less than DEADLINE_GRACE_WINDOW_SECONDS ago,
 * a response whose `phaseId` is the session's immediately previous phase
 * (the highest-numbered phase below the current one) is accepted as if that
 * phase were current: its task is looked up in that phase, and the decision
 * names that phase, so the response is stored against it. This keeps the
 * drafts the student app sends at the deadline (#1118). Every other
 * `phaseId` that is not the current phase is still refused with
 * PHASE_CHANGED: after a teacher's start, after the window, an older phase,
 * a phase of another session, and any phase while the first one is current.
 * The elapsed time is measured by the database (`now() - started_at`), the
 * clock that wrote `started_at`, so the server's clock does not matter. A
 * response without `phaseId` still goes to the current phase.
 *
 * Groups are deliberately not checked: a student without a group in a team
 * phase joined after the groups were formed, and may still submit (epic #923,
 * decision of 2026-10-31; placing them in a group is #930). The previous
 * phase in the grace window follows the same rule: it must belong to the
 * session the student is enrolled in, and no group in it is required.
 *
 * Validating the value and the justification is left to the route's handlers,
 * which receive the task found here. Like the other access checks, this is a
 * read, not a lock: a phase that changes between the check and the write is
 * not caught.
 */
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { isSessionParticipant } from "./activity-owner-helper.js";
import { summarizeSecurityRefusal } from "./log-safety.js";

export const STUDENT_RESPONSE_REFUSED_EVENT = "student_response_refused";

// How long, after the deadline runner starts a phase, the phase before it
// still takes answers (#1114). Not configurable: the student app sends its
// drafts at the deadline and right after the advance (#1118), well within it.
export const DEADLINE_GRACE_WINDOW_SECONDS = 15;

export const RESPONSE_REFUSAL_CODES = Object.freeze({
    SESSION_NOT_FOUND:       "SESSION_NOT_FOUND",
    ACTIVITY_FINISHED:       "ACTIVITY_FINISHED",
    NO_ACTIVE_PHASE:         "NO_ACTIVE_PHASE",
    PHASE_CHANGED:           "PHASE_CHANGED",
    UNSUPPORTED_DESIGN_TYPE: "UNSUPPORTED_DESIGN_TYPE",
    QUESTION_NOT_IN_PHASE:   "QUESTION_NOT_IN_PHASE",
});

const FINISHED_STATUS = getStatusCode("finished");

// $1 session id. The session's state and the type of the design its activity
// runs; one row when the session exists. For the grace window: what started
// the current phase, the seconds since it started by the database's clock,
// and the session's phase before it. All three are null without a current
// phase; the last two also for a phase started before V45 (no started_at)
// and for the first phase (no previous one).
export const STUDENT_RESPONSE_SESSION_SQL = `
    SELECT s.status,
           COALESCE(s.archived, false) AS archived,
           s.current_stage,
           (
               SELECT d.design->>'type'
               FROM activity AS a
               INNER JOIN designs AS d
                   ON d.id = a.design
               WHERE a.session = s.id
               ORDER BY a.id DESC
               LIMIT 1
           ) AS design_type,
           current_phase.start_trigger AS current_phase_start_trigger,
           EXTRACT(EPOCH FROM (now() - current_phase.started_at))
               AS current_phase_seconds_since_start,
           (
               SELECT previous_phase.id
               FROM stages AS previous_phase
               WHERE previous_phase.sesid = s.id
                 AND previous_phase.number < current_phase.number
               ORDER BY previous_phase.number DESC, previous_phase.id DESC
               LIMIT 1
           ) AS previous_phase_id
    FROM sessions AS s
    LEFT JOIN stages AS current_phase
        ON current_phase.id = s.current_stage
    WHERE s.id = $1
`;

// $1 phase id. What started the phase and the seconds since, by the
// database's clock; no row for an unknown phase.
export const PHASE_START_SQL = `
    SELECT start_trigger,
           EXTRACT(EPOCH FROM (now() - started_at)) AS seconds_since_start
    FROM stages
    WHERE id = $1
`;

// $1 phase id, $2 question id. A semantic differential question of the phase.
export const SEMANTIC_DIFFERENTIAL_TASK_SQL = `
    SELECT id, num AS num_values, justify AS requires_justification,
           word_count AS min_word_count
    FROM differential
    WHERE stageid = $1
      AND id = $2
    LIMIT 1;
`;

// $1 phase id, $2 item id. A ranking item (actor) of the phase.
export const RANKING_TASK_SQL = `
    SELECT id, justified AS requires_justification, word_count AS min_word_count
    FROM actors
    WHERE stageid = $1
      AND id = $2
    LIMIT 1;
`;

function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/*
 * What each design type answers: the id of the task a response targets, the
 * query that finds that task in a phase, and the message when it is not
 * there. A ranking response names its item in `itemId`, or in `questionId`.
 */
const TASKS_BY_DESIGN_TYPE = Object.freeze({
    semantic_differential: {
        taskId:   ({ questionId }) => positiveInteger(questionId),
        sql:      SEMANTIC_DIFFERENTIAL_TASK_SQL,
        notFound: "Question not found in the current phase.",
    },
    ranking: {
        taskId:   ({ questionId, payload }) => positiveInteger(payload?.itemId ?? questionId),
        sql:      RANKING_TASK_SQL,
        notFound: "Ranking item not found in the current phase.",
    },
});

export const STUDENT_RESPONSE_DESIGN_TYPES = Object.freeze(Object.keys(TASKS_BY_DESIGN_TYPE));

function refusal(status, code, error) {
    return { allowed: false, status, code, error };
}

/**
 * Whether a phase was started by the deadline runner less than
 * DEADLINE_GRACE_WINDOW_SECONDS ago, so that the phase before it still takes
 * answers (#1114).
 *
 * @param {Object} phase
 * @param {string|null} phase.startTrigger - `stages.start_trigger`.
 * @param {number|string|null} phase.secondsSinceStart - Measured by the
 *     database; PostgreSQL's EXTRACT returns it as a numeric string.
 */
export function isWithinDeadlineGraceWindow({ startTrigger, secondsSinceStart }) {
    if (startTrigger !== "deadline" || secondsSinceStart == null) {
        return false;
    }
    const seconds = Number(secondsSinceStart);
    return Number.isFinite(seconds) && seconds < DEADLINE_GRACE_WINDOW_SECONDS;
}

// Whether `phaseId`, which is not the current phase, may still be answered:
// it is the session's previous phase, and the current one started at its
// deadline within the grace window.
function acceptsPreviousPhaseAnswer(session, phaseId) {
    return phaseId !== null
        && phaseId === positiveInteger(session.previous_phase_id)
        && isWithinDeadlineGraceWindow({
            startTrigger:      session.current_phase_start_trigger,
            secondsSinceStart: session.current_phase_seconds_since_start,
        });
}

async function readSession(sessionId) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       STUDENT_RESPONSE_SESSION_SQL,
        sqlParams: [rpg2.param("plain", sessionId)],
    });
    return rows[0] ?? null;
}

async function readPhaseStart(phaseId) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       PHASE_START_SQL,
        sqlParams: [rpg2.param("plain", phaseId)],
    });
    return rows[0] ?? null;
}

/**
 * Whether the phase before `phaseId` still takes answers because the
 * deadline runner started `phaseId` within the grace window. The student
 * state caches use it not to keep a phase's view of earlier answers while
 * they can still change.
 *
 * @param {number} phaseId
 * @param {Object} [dependencies]
 * @param {(phaseId: number) => Promise<Object|null>} [dependencies.readPhaseStart]
 *     A row of PHASE_START_SQL, or null.
 * @returns {Promise<boolean>}
 */
export async function previousPhaseTakesAnswers(phaseId, {
    readPhaseStart: readStart = readPhaseStart,
} = {}) {
    const row = await readStart(phaseId);
    return row !== null && isWithinDeadlineGraceWindow({
        startTrigger:      row.start_trigger,
        secondsSinceStart: row.seconds_since_start,
    });
}

async function findTask({ designType, phaseId, taskId }) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       TASKS_BY_DESIGN_TYPE[designType].sql,
        sqlParams: [
            rpg2.param("plain", phaseId),
            rpg2.param("plain", taskId),
        ],
    });
    return rows[0] ?? null;
}

/**
 * Decides whether student `userId` may submit `payload` to the current phase
 * of session `sessionId`, or to the previous one within the grace window.
 *
 * @param {Object} request
 * @param {number} request.sessionId - The session id from the route.
 * @param {number} request.userId - The signed-in student.
 * @param {number} request.questionId - `questionId` from the body.
 * @param {Object} request.payload - The request body; `phaseId` is optional.
 * @param {Object} [dependencies] - Tests replace the database reads.
 * @param {(sessionId: number, userId: number) => Promise<boolean>}
 *     [dependencies.isParticipant]
 * @param {(sessionId: number) => Promise<Object|null>} [dependencies.readSession]
 *     A row of STUDENT_RESPONSE_SESSION_SQL, or null.
 * @param {(lookup: {designType: string, phaseId: number, taskId: number})
 *     => Promise<Object|null>} [dependencies.findTask]
 * @param {(message: string, entry: Object) => void} [dependencies.warn]
 * @returns {Promise<{allowed: true, phaseId: number, previousPhase: boolean,
 *     designType: string, taskId: number, task: Object}|{allowed: false,
 *     status: number, code: string, error: string}>} `phaseId` is the phase
 *     the response goes to; `previousPhase` is true when that is the previous
 *     phase, accepted in the grace window.
 */
export async function evaluateStudentResponse({ sessionId, userId, questionId, payload = {} }, {
    isParticipant = isSessionParticipant,
    readSession: readSessionState = readSession,
    findTask: findPhaseTask = findTask,
    warn = console.warn,
} = {}) {
    // A session the student is not enrolled in is answered as an unknown
    // one, before anything about it is read (#923).
    if (!(await isParticipant(sessionId, userId))) {
        warn("[security] Refused a student response.", summarizeSecurityRefusal(
            STUDENT_RESPONSE_REFUSED_EVENT,
            { userId, sessionId }
        ));
        return refusal(404, RESPONSE_REFUSAL_CODES.SESSION_NOT_FOUND, "Session not found.");
    }

    const session = await readSessionState(sessionId);
    if (!session) {
        return refusal(404, RESPONSE_REFUSAL_CODES.SESSION_NOT_FOUND, "Session not found.");
    }

    // Finishing also clears the current phase, so this comes first.
    if (Number(session.status) === FINISHED_STATUS || session.archived === true) {
        return refusal(409, RESPONSE_REFUSAL_CODES.ACTIVITY_FINISHED,
            "The activity has finished and no longer accepts responses.");
    }

    const currentPhaseId = positiveInteger(session.current_stage);
    if (currentPhaseId === null) {
        return refusal(409, RESPONSE_REFUSAL_CODES.NO_ACTIVE_PHASE, "Session has no active phase.");
    }

    let phaseId = currentPhaseId;
    const loadedPhaseId = payload?.phaseId;
    if (loadedPhaseId !== undefined && loadedPhaseId !== null
        && positiveInteger(loadedPhaseId) !== currentPhaseId) {
        if (!acceptsPreviousPhaseAnswer(session, positiveInteger(loadedPhaseId))) {
            return refusal(409, RESPONSE_REFUSAL_CODES.PHASE_CHANGED,
                "The activity moved to another phase. Reload it to answer the current phase.");
        }
        phaseId = positiveInteger(loadedPhaseId);
    }

    const designType = session.design_type;
    const tasks = Object.hasOwn(TASKS_BY_DESIGN_TYPE, designType ?? "")
        ? TASKS_BY_DESIGN_TYPE[designType]
        : null;
    if (!tasks) {
        return refusal(400, RESPONSE_REFUSAL_CODES.UNSUPPORTED_DESIGN_TYPE,
            `Unsupported design type: ${designType}`);
    }

    const taskId = tasks.taskId({ questionId, payload });
    const task = taskId === null ? null : await findPhaseTask({ designType, phaseId, taskId });
    if (!task) {
        return refusal(400, RESPONSE_REFUSAL_CODES.QUESTION_NOT_IN_PHASE, tasks.notFound);
    }

    return {
        allowed:       true,
        phaseId,
        previousPhase: phaseId !== currentPhaseId,
        designType,
        taskId,
        task,
    };
}
