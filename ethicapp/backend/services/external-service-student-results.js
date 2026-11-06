import { STUDENT_RESULTS_READING_HOOK } from "../external-services/catalog.js";
import {
    errorClassification,
    runHandlerWithTimeout,
    TIMED_OUT,
} from "./external-service-handler-run.js";
import { createStudentResultsReader } from "./external-service-report-results.service.js";

/**
 * The `student-results-reading` hook (epic #1123, #1125): when a student
 * loads an activity, the adapters of the services enabled for its session
 * rebuild, from their stored callbacks, the results they published to that
 * student with `publishStudentResult`.
 *
 * Like `report-building`, it has its own collecting dispatch, not
 * dispatchHook(): every handler is awaited under a timeout and returns a list,
 * no job or result row is created, no `callback` is passed and no remote
 * service is called. The handler reads its own stored results through a
 * reader bound to its service, the session and the student. Which services
 * are asked is the registry's decision (collectStudentResults() there).
 */

export { STUDENT_RESULTS_READING_HOOK };

// A student waits for it while the activity loads, so it is shorter than the
// report's five seconds.
export const STUDENT_RESULTS_TIMEOUT_MS = 3000;

export const STUDENT_RESULTS_STATUS = Object.freeze({
    COMPLETED: "completed",
    FAILED:    "failed",
    TIMED_OUT: "timed_out",
    INVALID:   "invalid",
});

// What a handler returns for each result, as `publishStudentResult` emits it
// plus the id of the stored result it was rebuilt from.
export const STUDENT_RESULT_KEYS = Object.freeze([
    "resultId", "phaseId", "questionId", "component", "payload", "message", "status", "publishedAt",
]);

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function deepFreeze(value) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const nested of Object.values(value)) {
            deepFreeze(nested);
        }
    }
    return value;
}

// A frozen copy of plain data, so the handler cannot change what it returned
// (a timed-out one keeps running), or null when it is not cloneable.
function frozenCopy(value) {
    try {
        return deepFreeze(structuredClone(value));
    } catch {
        return null;
    }
}

function isoDate(value) {
    const date = typeof value === "string" || value instanceof Date ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

// Problems name paths only, never a value: they are logged, and a value can
// carry a student's text.
function validateEntry(entry, label, { readResults, seenResultIds }) {
    if (!isPlainObject(entry)) {
        return { problems: [`${label} must be an object`] };
    }

    const problems = [];
    if (Object.keys(entry).some(key => !STUDENT_RESULT_KEYS.includes(key))) {
        problems.push(`${label} has unknown keys`);
    }

    const result = typeof entry.resultId === "string" ? readResults.get(entry.resultId) : undefined;
    if (!result) {
        problems.push(
            `${label}.resultId is not one of the results the service read for the student`
        );
    } else if (seenResultIds.has(entry.resultId)) {
        problems.push(`${label}.resultId repeats an earlier entry`);
    }

    // The stored result's phase and question are the trusted destination of
    // its callback; an entry cannot move it elsewhere.
    if (!isPositiveInteger(entry.phaseId)) {
        problems.push(`${label}.phaseId must be a positive integer`);
    } else if (result && result.phaseId !== null && Number(result.phaseId) !== entry.phaseId) {
        problems.push(`${label}.phaseId is not the phase of its result`);
    }
    const questionId = entry.questionId ?? null;
    if (questionId !== null && !isPositiveInteger(questionId)) {
        problems.push(`${label}.questionId must be a positive integer or null`);
    } else if (result && result.questionId !== null && Number(result.questionId) !== questionId) {
        problems.push(`${label}.questionId is not the question of its result`);
    }

    const component = isPlainObject(entry.component) ? frozenCopy(entry.component) : null;
    if (!component || typeof component.componentId !== "string" || !component.componentId.trim()) {
        problems.push(`${label}.component must be plain data with a componentId`);
    }
    const payload = isPlainObject(entry.payload) ? frozenCopy(entry.payload) : null;
    if (!payload) {
        problems.push(`${label}.payload must be a plain data object`);
    }

    const message = entry.message ?? null;
    if (message !== null && typeof message !== "string") {
        problems.push(`${label}.message must be a string or null`);
    }
    if (typeof entry.status !== "string" || !entry.status.trim()) {
        problems.push(`${label}.status must be a non-empty string`);
    }
    const publishedAt = isoDate(entry.publishedAt);
    if (!publishedAt) {
        problems.push(`${label}.publishedAt must be a date`);
    }

    if (problems.length > 0) {
        return { problems };
    }
    seenResultIds.add(entry.resultId);
    return {
        problems,
        entry: {
            resultId: entry.resultId,
            phaseId:  entry.phaseId,
            questionId,
            component,
            payload,
            message,
            status:   entry.status,
            publishedAt,
        },
    };
}

/**
 * Validates what a `student-results-reading` handler returned: a list of
 * `{ resultId, phaseId, questionId, component, payload, message, status,
 * publishedAt }`; `undefined` or `null` means nothing.
 *
 * Each entry is checked on its own, and an entry with any problem is dropped
 * while the others are kept:
 * - `resultId` is the id of a result the handler's reader returned
 *   (`readResults`), once at most;
 * - `phaseId` is a positive integer and `questionId` a positive integer or
 *   null; each must equal its result's when the result has one;
 * - `component` is plain data with a non-empty `componentId`, `payload` a
 *   plain data object; both are copied;
 * - `message` is a string or null, `status` a non-empty string and
 *   `publishedAt` a date (normalized to ISO 8601);
 * - no other key is accepted.
 *
 * @param {unknown} returned
 * @param {{ readResults: Map<string, Object> }} options - The results the
 *     handler's reader returned, by id.
 * @returns {{ valid: boolean, entries: Object[], problems: string[] }} `valid`
 *     is false only when `returned` is not a list; `entries` holds the kept
 *     entries, normalized, and `problems` why the others were dropped.
 */
export function validateStudentResults(returned, { readResults }) {
    if (returned === undefined || returned === null) {
        return { valid: true, entries: [], problems: [] };
    }
    if (!Array.isArray(returned)) {
        return { valid: false, entries: [], problems: ["the handler must return a list"] };
    }

    const entries = [];
    const problems = [];
    const seenResultIds = new Set();
    returned.forEach((item, index) => {
        const checked = validateEntry(item, `entries[${index}]`, { readResults, seenResultIds });
        problems.push(...checked.problems);
        if (checked.entry) {
            entries.push(checked.entry);
        }
    });
    return { valid: true, entries, problems };
}

// Every handler left out, and every handler some of whose entries were
// dropped, is logged as one line of identifiers, never with text from the
// handler, its error or its entries.
function logLeftOut(details) {
    console.warn("[external-services] Left out student results.", JSON.stringify(details));
}

async function collectOne({ context, serviceId, handler, resultsStore, timeoutMs }) {
    const ids = { serviceId, sessionId: context.sessionId };
    const readResults = new Map();
    const results = createStudentResultsReader(resultsStore, { serviceId, ...context }, {
        onRead: result => readResults.set(result.id, result),
    });

    const controller = new AbortController();
    let returned;
    try {
        returned = await runHandlerWithTimeout(handler, [
            Object.freeze({ serviceId, sessionId: context.sessionId, userId: context.userId }),
            { results, signal: controller.signal },
        ], timeoutMs, controller);
    } catch (error) {
        logLeftOut({
            ...ids,
            status: STUDENT_RESULTS_STATUS.FAILED,
            ...errorClassification(error),
        });
        return { serviceId, status: STUDENT_RESULTS_STATUS.FAILED, entries: [] };
    }

    if (returned === TIMED_OUT) {
        logLeftOut({ ...ids, status: STUDENT_RESULTS_STATUS.TIMED_OUT, timeoutMs });
        return { serviceId, status: STUDENT_RESULTS_STATUS.TIMED_OUT, entries: [] };
    }

    const { valid, entries, problems } = validateStudentResults(returned, { readResults });
    if (!valid) {
        logLeftOut({ ...ids, status: STUDENT_RESULTS_STATUS.INVALID, problems });
        return { serviceId, status: STUDENT_RESULTS_STATUS.INVALID, entries: [] };
    }
    if (problems.length > 0) {
        logLeftOut({
            ...ids,
            status:  STUDENT_RESULTS_STATUS.COMPLETED,
            kept:    entries.length,
            dropped: returned.length - entries.length,
            problems,
        });
    }
    return { serviceId, status: STUDENT_RESULTS_STATUS.COMPLETED, entries };
}

/**
 * Asks `subscribers` for the results their services published to one student
 * of a session, and merges the valid entries.
 *
 * @param {Object} options
 * @param {{ sessionId: number, userId: number }} options.context
 * @param {Array<{ serviceId, handler }>} options.subscribers - The services to
 *     ask, in subscription order, already selected by the registry.
 * @param {Object} options.resultsStore - An ExternalServiceReportResultsService.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<ReadonlyArray<Object>>} Frozen `{ serviceId, resultId,
 *     phaseId, questionId, component, payload, message, status, publishedAt }`,
 *     oldest `publishedAt` first; ties keep the subscription order, then each
 *     handler's order. A handler that fails, times out or returns something
 *     other than a list contributes nothing and never affects the others.
 */
export async function collectStudentResults({
    context,
    subscribers,
    resultsStore,
    timeoutMs = STUDENT_RESULTS_TIMEOUT_MS,
}) {
    const outcomes = await Promise.all(subscribers.map(({ serviceId, handler }) => collectOne({
        context, serviceId, handler, resultsStore, timeoutMs,
    })));

    const merged = outcomes.flatMap(({ serviceId, entries }) =>
        entries.map(entry => ({ serviceId, ...entry })));
    merged.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    return Object.freeze(merged.map(entry => Object.freeze(entry)));
}
