/**
 * What the external-services path may write to the container log (#876).
 *
 * Callback payloads, adapter results and AI Additions error bodies can carry
 * a student's text or prose that paraphrases it (the tutor's
 * `claimTypeRationale`, a validation error that echoes a chat message). The
 * log outlives the forgetting of a student, so those values are never
 * logged: only ids, the service, the hook, statuses, counts and sizes.
 */

const MAX_MESSAGE_LENGTH = 300;

function byteSize(value) {
    if (value === undefined) {
        return 0;
    }
    try {
        return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
    } catch {
        return null;
    }
}

function idOrNull(value) {
    return typeof value === "number" || typeof value === "string" ? value : null;
}

/**
 * An error as it may be logged: its name, code, HTTP status and message,
 * never the response body or other attached data. AI Additions client
 * errors carry the body in `responseBody`.
 * @param {unknown} error
 * @returns {{ name: string|null, code: string|null, statusCode: number|null,
 *     message: string|null }}
 */
export function describeError(error) {
    const message = typeof error?.message === "string" ? error.message : null;
    return {
        name: typeof error?.name === "string" ? error.name : null,
        code: typeof error?.code === "string" || typeof error?.code === "number"
            ? String(error.code)
            : null,
        statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
        message:    message && message.length > MAX_MESSAGE_LENGTH
            ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
            : message,
    };
}

/**
 * A callback result as it may be logged: the destination ids, its status,
 * the names of its payload fields and its size in bytes.
 * @param {Object} entry
 * @param {string} entry.serviceId
 * @param {string} entry.hookName
 * @param {unknown} entry.result - The adapter's `callback(result)` value.
 * @param {Object} [entry.context] - The handler context.
 */
export function summarizeCallbackResult({ serviceId, hookName, result, context = {} }) {
    const payload = result && typeof result === "object" ? result.payload : undefined;
    return {
        serviceId,
        hookName,
        jobId:       idOrNull(context.jobId),
        resultId:    idOrNull(context.resultId),
        sessionId:   idOrNull(context.sessionId),
        phaseId:     idOrNull(context.phaseId),
        questionId:  idOrNull(context.questionId),
        groupId:     idOrNull(context.groupId),
        userId:      idOrNull(context.userId),
        status:      typeof result?.status === "string" ? result.status : null,
        payloadKeys: payload && typeof payload === "object" && !Array.isArray(payload)
            ? Object.keys(payload).slice(0, 20)
            : [],
        resultBytes: byteSize(result),
    };
}

// A positive integer, or a string of digits that is one; null otherwise.
function positiveIdOrNull(value) {
    const id = typeof value === "string" && /^[0-9]{1,15}$/u.test(value) ? Number(value) : value;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * A refused request that may point to tampering, as it may be logged (#924):
 * the event and the ids involved. Ids often come from the request, so each one
 * is kept only when it is a positive integer and is null otherwise; no other
 * request value reaches the log.
 * @param {string} event - A constant that names the refusal, never request
 *     input.
 * @param {Object<string, unknown>} [ids] - Such as `{ userId, designId }`.
 * @returns {Object} `{ event, ...ids }`.
 */
export function summarizeSecurityRefusal(event, ids = {}) {
    const entry = { event };
    for (const [name, value] of Object.entries(ids)) {
        entry[name] = positiveIdOrNull(value);
    }
    return entry;
}
