import { REPORT_BUILDING_HOOK } from "../external-services/catalog.js";
import { describeError } from "../helpers/log-safety.js";
import { createReportResultsReader } from "./external-service-report-results.service.js";

/**
 * The `report-building` hook (epic #620, #944): while a report is built, the
 * adapters of the services that worked in its session add their data to it.
 *
 * It has its own collecting dispatch, not dispatchHook(): every handler is
 * awaited under a timeout and returns a contribution, no job or result row is
 * created, no `callback` is passed and no remote service is called. The
 * handler reads its own stored results through a reader bound to its service
 * and the report's session. Merging the contributions into the report is the
 * generator's job (#945).
 */

export { REPORT_BUILDING_HOOK };

// What identifies a row of each report, as `context.rows[n][key]` and as the
// `rowKey` of a contributed value.
export const REPORT_ROW_KEYS = Object.freeze({
    responses:       "responseId",
    chat_transcript: "messageId",
});
export const REPORT_TYPES = Object.freeze(Object.keys(REPORT_ROW_KEYS));

export const REPORT_CONTRIBUTION_TIMEOUT_MS = 5000;

export const CONTRIBUTION_STATUS = Object.freeze({
    COMPLETED: "completed",
    FAILED:    "failed",
    TIMED_OUT: "timed_out",
    INVALID:   "invalid",
});

// Longer strings make a contribution invalid; they are not truncated.
export const MAX_CONTRIBUTION_STRING_LENGTH = 10000;
export const MAX_COLUMN_LABEL_LENGTH        = 200;

// A contributed column id: snake_case, after the service's
// `report.columnPrefix` (catalog.js).
const COLUMN_ID_PATTERN = /^[a-z][a-z0-9_]*$/u;

const CONTRIBUTION_KEYS     = Object.freeze(["columns", "values", "rows"]);
const COLUMN_KEYS           = Object.freeze(["id", "label"]);
const VALUE_ENTRY_KEYS      = Object.freeze(["rowKey", "values"]);
const CONTRIBUTED_ROW_KEYS  = Object.freeze(["phaseId", "questionId", "groupId", "time", "message", "values"]);

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function unknownKeys(object, allowed) {
    return Object.keys(object).filter(key => !allowed.includes(key));
}

// Problems name paths and column ids only, never a value: they are logged and
// audited, and a value can carry a student's text.
function validateColumns(columns, { columnPrefix, reservedColumnIds }, problems) {
    if (columns === undefined) {
        return [];
    }
    if (!Array.isArray(columns)) {
        problems.push("columns must be a list");
        return [];
    }

    const normalized = [];
    const seen = new Set();
    columns.forEach((column, index) => {
        const label = `columns[${index}]`;
        if (!isPlainObject(column)) {
            problems.push(`${label} must be an object { id, label? }`);
            return;
        }
        if (unknownKeys(column, COLUMN_KEYS).length > 0) {
            problems.push(`${label} has unknown keys`);
        }

        const { id } = column;
        if (typeof id !== "string" || !COLUMN_ID_PATTERN.test(id)
            || !id.startsWith(columnPrefix) || id.length === columnPrefix.length) {
            problems.push(`${label}.id must be a snake_case id that starts with ${columnPrefix}`);
            return;
        }
        if (reservedColumnIds.has(id)) {
            problems.push(`${label}.id ${id} is a report column`);
            return;
        }
        if (seen.has(id)) {
            problems.push(`${label}.id ${id} is repeated`);
            return;
        }
        seen.add(id);

        if (column.label !== undefined && (typeof column.label !== "string"
            || column.label.length > MAX_COLUMN_LABEL_LENGTH)) {
            problems.push(`${label}.label must be a string of at most ${MAX_COLUMN_LABEL_LENGTH} characters`);
        }
        normalized.push({ id, label: typeof column.label === "string" ? column.label : null });
    });
    return normalized;
}

function isScalar(value) {
    return value === null
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
        || (typeof value === "string" && value.length <= MAX_CONTRIBUTION_STRING_LENGTH);
}

function validateCellValues(values, columnIds, label, problems) {
    if (!isPlainObject(values)) {
        problems.push(`${label} must be an object of column ids to values`);
        return {};
    }

    const normalized = {};
    for (const [columnId, value] of Object.entries(values)) {
        if (!columnIds.has(columnId)) {
            problems.push(`${label} names undeclared column ${COLUMN_ID_PATTERN.test(columnId)
                ? columnId : "(malformed id)"}`);
        } else if (!isScalar(value)) {
            problems.push(`${label}.${columnId} must be a string of at most `
                + `${MAX_CONTRIBUTION_STRING_LENGTH} characters, a finite number, a boolean or null`);
        } else {
            normalized[columnId] = value;
        }
    }
    return normalized;
}

function validateValueEntries(entries, { columnIds, rowKeys }, problems) {
    if (entries === undefined) {
        return [];
    }
    if (!Array.isArray(entries)) {
        problems.push("values must be a list");
        return [];
    }

    const normalized = [];
    const seen = new Set();
    entries.forEach((entry, index) => {
        const label = `values[${index}]`;
        if (!isPlainObject(entry)) {
            problems.push(`${label} must be an object { rowKey, values }`);
            return;
        }
        if (unknownKeys(entry, VALUE_ENTRY_KEYS).length > 0) {
            problems.push(`${label} has unknown keys`);
        }

        const isKeyType = typeof entry.rowKey === "string" || typeof entry.rowKey === "number";
        const rowKey = isKeyType ? rowKeys.get(String(entry.rowKey)) : undefined;
        if (rowKey === undefined) {
            problems.push(`${label}.rowKey is not a row of the report`);
            return;
        }
        if (seen.has(String(rowKey))) {
            problems.push(`${label}.rowKey repeats an earlier entry`);
            return;
        }
        seen.add(String(rowKey));

        normalized.push({
            rowKey,
            values: validateCellValues(entry.values, columnIds, `${label}.values`, problems),
        });
    });
    return normalized;
}

function validateContributedRows(rows, { reportType, columnIds }, problems) {
    if (rows === undefined) {
        return [];
    }
    if (reportType !== "chat_transcript") {
        problems.push(`rows are not accepted by the ${reportType} report`);
        return [];
    }
    if (!Array.isArray(rows)) {
        problems.push("rows must be a list");
        return [];
    }

    const normalized = [];
    rows.forEach((row, index) => {
        const label = `rows[${index}]`;
        if (!isPlainObject(row)) {
            problems.push(`${label} must be an object`);
            return;
        }
        if (unknownKeys(row, CONTRIBUTED_ROW_KEYS).length > 0) {
            problems.push(`${label} has unknown keys`);
        }
        if (!isPositiveInteger(row.phaseId)) {
            problems.push(`${label}.phaseId must be a positive integer`);
        }
        for (const key of ["questionId", "groupId"]) {
            if (row[key] !== undefined && row[key] !== null && !isPositiveInteger(row[key])) {
                problems.push(`${label}.${key} must be a positive integer or null`);
            }
        }

        const time = typeof row.time === "string" || row.time instanceof Date
            ? new Date(row.time)
            : null;
        if (!time || Number.isNaN(time.getTime())) {
            problems.push(`${label}.time must be a date`);
        }

        if (row.message !== undefined && row.message !== null && (typeof row.message !== "string"
            || row.message.length > MAX_CONTRIBUTION_STRING_LENGTH)) {
            problems.push(`${label}.message must be a string of at most `
                + `${MAX_CONTRIBUTION_STRING_LENGTH} characters or null`);
        }

        normalized.push({
            phaseId:    row.phaseId,
            questionId: row.questionId ?? null,
            groupId:    row.groupId ?? null,
            time:       time && !Number.isNaN(time.getTime()) ? time.toISOString() : null,
            message:    typeof row.message === "string" ? row.message : null,
            values:     row.values === undefined
                ? {}
                : validateCellValues(row.values, columnIds, `${label}.values`, problems),
        });
    });
    return normalized;
}

/**
 * Validates what a `report-building` handler returned.
 *
 * A contribution is `{ columns?, values?, rows? }`; `undefined` or `null`
 * means nothing to add.
 * - `columns`: `[{ id, label? }]`. Each id is snake_case, starts with the
 *   service's `columnPrefix`, is not one of `reservedColumnIds` (the report's
 *   own columns) and is not repeated.
 * - `values`: `[{ rowKey, values }]`. `rowKey` is the key of a row of the
 *   report (REPORT_ROW_KEYS), once at most; `values` maps declared column ids
 *   to scalars: strings of at most MAX_CONTRIBUTION_STRING_LENGTH characters,
 *   finite numbers, booleans or null.
 * - `rows`, chat transcript only: `[{ phaseId, questionId?, groupId?, time,
 *   message?, values? }]`. The generator attributes them to the service.
 *
 * Any problem makes the whole contribution invalid.
 *
 * @param {unknown} contribution
 * @param {Object} options
 * @param {string} options.reportType - One of REPORT_TYPES.
 * @param {Map<string, string|number>} options.rowKeys - The report's row
 *     keys, by their string form.
 * @param {string} options.columnPrefix
 * @param {Set<string>} [options.reservedColumnIds]
 * @returns {{ valid: boolean, contribution: Object|null, problems: string[] }}
 *     `contribution` is a normalized copy when valid.
 */
export function validateReportContribution(contribution, {
    reportType,
    rowKeys,
    columnPrefix,
    reservedColumnIds = new Set(),
}) {
    if (contribution === undefined || contribution === null) {
        return { valid: true, contribution: { columns: [], values: [], rows: [] }, problems: [] };
    }
    if (!isPlainObject(contribution)) {
        return { valid: false, contribution: null, problems: ["the contribution must be an object"] };
    }

    const problems = [];
    if (unknownKeys(contribution, CONTRIBUTION_KEYS).length > 0) {
        problems.push("the contribution has unknown keys");
    }

    const columns = validateColumns(contribution.columns, { columnPrefix, reservedColumnIds }, problems);
    const columnIds = new Set(columns.map(column => column.id));
    const values = validateValueEntries(contribution.values, { columnIds, rowKeys }, problems);
    const rows = validateContributedRows(contribution.rows, { reportType, columnIds }, problems);

    return problems.length > 0
        ? { valid: false, contribution: null, problems }
        : { valid: true, contribution: { columns, values, rows }, problems: [] };
}

function assertReportArguments(reportType, context) {
    if (!REPORT_TYPES.includes(reportType)) {
        throw new TypeError(`Unknown report type: ${reportType}.`);
    }
    if (!isPositiveInteger(context?.sessionId)) {
        throw new TypeError("A report contribution context needs a positive integer sessionId.");
    }
    if (!Array.isArray(context.rows)) {
        throw new TypeError("A report contribution context needs its rows.");
    }
}

// The report's row keys, by their string form, so a contributed rowKey of
// either type finds its row.
function rowKeysOf(reportType, rows) {
    const keyName = REPORT_ROW_KEYS[reportType];
    const rowKeys = new Map();
    for (const row of rows) {
        const key = row?.[keyName];
        if (typeof key === "string" || typeof key === "number") {
            rowKeys.set(String(key), key);
        }
    }
    return rowKeys;
}

// What a handler receives as `context`: a frozen copy, so one adapter cannot
// change what the next one or the generator sees.
function handlerContext(reportType, context, serviceId) {
    return Object.freeze({
        reportType,
        serviceId,
        sessionId:  context.sessionId,
        designType: context.designType ?? null,
        rows:       Object.freeze(context.rows.map(row => Object.freeze({ ...row }))),
    });
}

const TIMED_OUT = Symbol("timed out");

// A handler that outlives its timeout cannot be stopped; its `signal` is
// aborted so it can stop by itself, and what it returns later is ignored.
async function runHandler(handler, handlerArgs, timeoutMs, controller) {
    let timeoutId;
    const timeout = new Promise(resolve => {
        timeoutId = setTimeout(() => {
            controller.abort();
            resolve(TIMED_OUT);
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            Promise.resolve().then(() => handler(...handlerArgs)),
            timeout,
        ]);
    } finally {
        clearTimeout(timeoutId);
    }
}

async function collectOne({
    reportType, context, serviceId, service, handler, resultsStore, timeoutMs, rowKeys,
    reservedColumnIds,
}) {
    const columnPrefix = service.report?.columnPrefix ?? null;
    const describe = `${serviceId} for the ${reportType} report of session ${context.sessionId}`;

    if (!columnPrefix) {
        const reason = "the service declares no report.columnPrefix";
        console.warn(`[external-services] Left out the report contribution of ${describe}: ${reason}.`);
        return { serviceId, status: CONTRIBUTION_STATUS.INVALID, reason, problems: [reason] };
    }

    const controller = new AbortController();
    let returned;
    try {
        returned = await runHandler(handler, [
            handlerContext(reportType, context, serviceId),
            {
                results: createReportResultsReader(resultsStore, { serviceId, sessionId: context.sessionId }),
                signal:  controller.signal,
            },
        ], timeoutMs, controller);
    } catch (error) {
        console.warn(
            `[external-services] Left out the report contribution of ${describe}: the handler failed.`,
            JSON.stringify(describeError(error))
        );
        return { serviceId, status: CONTRIBUTION_STATUS.FAILED, reason: "the handler failed" };
    }

    if (returned === TIMED_OUT) {
        const reason = `timed out after ${timeoutMs} ms`;
        console.warn(`[external-services] Left out the report contribution of ${describe}: ${reason}.`);
        return { serviceId, status: CONTRIBUTION_STATUS.TIMED_OUT, reason };
    }

    const { valid, contribution, problems } = validateReportContribution(returned, {
        reportType, rowKeys, columnPrefix, reservedColumnIds,
    });
    if (!valid) {
        console.warn(
            `[external-services] Left out the report contribution of ${describe}: it is invalid.`,
            JSON.stringify({ problems })
        );
        return { serviceId, status: CONTRIBUTION_STATUS.INVALID, reason: "the contribution is invalid", problems };
    }

    return { serviceId, status: CONTRIBUTION_STATUS.COMPLETED, contribution };
}

/**
 * Collects the contributions to a report from the services that worked in
 * its session: those registered, subscribed to `report-building`, and with at
 * least one job in the session, whatever the AI service policy says today
 * (the data was produced while they were allowed).
 *
 * @param {Object} options
 * @param {string} options.reportType - One of REPORT_TYPES.
 * @param {Object} options.context - `{ sessionId, designType, rows }`; `rows`
 *     are the report's row keys (see the README, "report-building").
 * @param {Map<string, Object>} options.services - The registered services.
 * @param {Array<{ serviceId, handler }>} options.subscribers - The
 *     `report-building` subscribers.
 * @param {Object} options.resultsStore - An ExternalServiceReportResultsService.
 * @param {number} [options.timeoutMs]
 * @param {Iterable<string>} [options.reservedColumnIds] - The report's own
 *     column ids, which contributions may not reuse.
 * @returns {Promise<Object[]>} One outcome per asked service, in subscription
 *     order: `{ serviceId, status: "completed", contribution }`, or
 *     `{ serviceId, status: "failed" | "timed_out" | "invalid", reason,
 *     problems? }`. One service's outcome never affects another's. Rejects
 *     only for invalid arguments or when the services cannot be selected.
 */
export async function collectReportContributions({
    reportType,
    context,
    services,
    subscribers,
    resultsStore,
    timeoutMs = REPORT_CONTRIBUTION_TIMEOUT_MS,
    reservedColumnIds = [],
}) {
    assertReportArguments(reportType, context);

    const subscribed = subscribers.filter(({ serviceId }) => services.has(serviceId));
    if (subscribed.length === 0) {
        return [];
    }

    const sessionServiceIds = new Set(await resultsStore.listSessionServiceIds(context.sessionId));
    const asked = subscribed.filter(({ serviceId }) => sessionServiceIds.has(serviceId));

    const rowKeys = rowKeysOf(reportType, context.rows);
    const reserved = new Set(reservedColumnIds);

    return Promise.all(asked.map(({ serviceId, handler }) => collectOne({
        reportType,
        context,
        serviceId,
        service:           services.get(serviceId),
        handler,
        resultsStore,
        timeoutMs,
        rowKeys,
        reservedColumnIds: reserved,
    })));
}
