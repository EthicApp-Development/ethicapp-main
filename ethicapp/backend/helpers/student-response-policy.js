/**
 * Whether a student may submit a response to the current phase of an
 * activity (`POST /activities/:id/response`, #927, epic #923).
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
 * | phase                                          |        |                         |
 * | the design type takes no responses here        | 400    | UNSUPPORTED_DESIGN_TYPE |
 * | the question or ranking item is not in the     | 400    | QUESTION_NOT_IN_PHASE   |
 * | current phase                                  |        |                         |
 *
 * The checks run in that order. The first one reuses the participant rule of
 * the activity endpoints (isSessionParticipant), so a session the student is
 * not enrolled in is answered as an unknown one and its state is never read.
 * That refusal is also logged as a security event, with ids only.
 *
 * Groups are deliberately not checked: a student without a group in a team
 * phase joined after the groups were formed, and may still submit (epic #923,
 * decision of 2026-10-31; placing them in a group is #930).
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
// runs; one row when the session exists.
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
           ) AS design_type
    FROM sessions AS s
    WHERE s.id = $1
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

async function readSession(sessionId) {
    const rows = await rpg2.execSQL({
        dbcon:     config.dbconnString,
        sql:       STUDENT_RESPONSE_SESSION_SQL,
        sqlParams: [rpg2.param("plain", sessionId)],
    });
    return rows[0] ?? null;
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
 * of session `sessionId`.
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
 * @returns {Promise<{allowed: true, phaseId: number, designType: string,
 *     taskId: number, task: Object}|{allowed: false, status: number,
 *     code: string, error: string}>}
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

    const phaseId = positiveInteger(session.current_stage);
    if (phaseId === null) {
        return refusal(409, RESPONSE_REFUSAL_CODES.NO_ACTIVE_PHASE, "Session has no active phase.");
    }

    const loadedPhaseId = payload?.phaseId;
    if (loadedPhaseId !== undefined && loadedPhaseId !== null
        && positiveInteger(loadedPhaseId) !== phaseId) {
        return refusal(409, RESPONSE_REFUSAL_CODES.PHASE_CHANGED,
            "The activity moved to another phase. Reload it to answer the current phase.");
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

    return { allowed: true, phaseId, designType, taskId, task };
}
