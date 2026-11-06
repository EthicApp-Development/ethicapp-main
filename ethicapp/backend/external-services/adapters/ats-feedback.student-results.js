import { buildStudentFeedback } from "./ats-feedback.utils.js";

/**
 * The argumentation tutor's `student-results-reading` handler (epic #1123,
 * #1126): the feedback the adapter published to one student in one
 * activity, rebuilt from the stored callbacks. The tutor is not called and
 * nothing is stored.
 *
 * A stored result is one the adapter published to the student when:
 * - its status is `completed`: the adapter processed the callback and
 *   published it. `failed` results were refused or failed before or while
 *   publishing, `callback-received` ones were never finished and
 *   `unknown-correlation` ones were never processed (the reader already
 *   leaves `pending` ones out);
 * - its `adapter_result` records the student as `publishedToUserId`, which
 *   the adapter has written with every result it processed since before the
 *   results table existed (V15).
 *
 * Each one is rebuilt with buildStudentFeedback(), the function the live
 * path publishes with, from its `raw_payload` and its ids, which are the ids
 * of the job the live path took as the callback's destination. The rebuilt
 * entry is therefore the result published live, with the stored result's id
 * and its `receivedAt` as `publishedAt`. A forgotten student's payloads are
 * redacted as stored (#876) and are rebuilt as such.
 */

const PUBLISHED_STATUS = "completed";

function positiveIdOrNull(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// The student the adapter published the result to, from its own record of
// the callback (`adapter_result.payload.publishedToUserId`).
function publishedToUserId(result) {
    return positiveIdOrNull(result?.adapterResult?.payload?.publishedToUserId);
}

/**
 * @param {{serviceId: string, sessionId: number, userId: number}} context
 * @param {{results: {list: Function}}} reader - The student results reader.
 * @returns {Promise<Object[]>} `{ resultId, phaseId, questionId, component,
 *     payload, message, status, publishedAt }`, oldest first.
 */
export async function readStudentResults(context, { results }) {
    const stored = await results.list();

    return stored
        .filter(result => result.status === PUBLISHED_STATUS
            && publishedToUserId(result) === context.userId)
        .map(result => {
            const { studentResult } = buildStudentFeedback(result.rawPayload, {
                sessionId:  context.sessionId,
                phaseId:    result.phaseId,
                questionId: result.questionId,
                userId:     result.userId,
            });
            return {
                resultId:    result.id,
                ...studentResult,
                publishedAt: result.receivedAt,
            };
        });
}
