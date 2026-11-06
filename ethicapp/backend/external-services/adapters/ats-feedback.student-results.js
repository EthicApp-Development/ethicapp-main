import { buildStudentFeedback, documentLocaleOf } from "./ats-feedback.utils.js";

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
 * and its `receivedAt` as `publishedAt`, as the registry emits a document:
 * `component: { documentSchema }` with the document as `payload` (#1133). A
 * forgotten student's payloads are redacted as stored (#876) and are rebuilt
 * as such.
 *
 * A callback without the tutor's `studentResult` is mapped in the locale the
 * live path recorded (`adapter_result.payload.studentDocument.locale`). A
 * callback processed before #1133 has none, and was never published as a
 * document: it is mapped in the activity's locale, read once per call with
 * `loadActivityLocale`, and only when such a callback is rebuilt.
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

// The locale the live path mapped the callback in, when it recorded one.
function recordedLocale(result) {
    return documentLocaleOf(result?.adapterResult?.payload?.studentDocument?.locale);
}

/**
 * @param {{serviceId: string, sessionId: number, userId: number}} context
 * @param {{results: {list: Function}}} reader - The student results reader.
 * @param {Object} [dependencies]
 * @param {(sessionId: number) => Promise<string|null>} [dependencies.loadActivityLocale]
 *     - The activity's locale, or null; never rejects. Without it, callbacks
 *     with no recorded locale are mapped in the default locale.
 * @returns {Promise<Object[]>} `{ resultId, phaseId, questionId, component,
 *     payload, message, status, publishedAt }`, oldest first.
 */
export async function readStudentResults(context, { results }, {
    loadActivityLocale = async () => null,
} = {}) {
    const stored = await results.list();

    let sessionLocale = null;
    const activityLocale = () => {
        sessionLocale ??= loadActivityLocale(context.sessionId);
        return sessionLocale;
    };

    const published = stored.filter(result => result.status === PUBLISHED_STATUS
        && publishedToUserId(result) === context.userId);
    return Promise.all(published.map(async result => {
        const { studentResult } = await buildStudentFeedback(result.rawPayload, {
            sessionId:  context.sessionId,
            phaseId:    result.phaseId,
            questionId: result.questionId,
            userId:     result.userId,
        }, {
            resolveLocale: async () => recordedLocale(result) ?? activityLocale(),
        });
        const { documentSchema, document, ...rest } = studentResult;
        return {
            resultId:    result.id,
            ...rest,
            component:   { documentSchema },
            payload:     document,
            publishedAt: result.receivedAt,
        };
    }));
}
