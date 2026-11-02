import { poolQuery, RESULT_STATUS } from "./external-service-jobs.service.js";

/**
 * What the `report-building` hook (epic #620, #944) reads from EthicApp's
 * database: which services worked in a session, and each service's stored
 * results for it. It only reads; the collecting dispatch creates no job or
 * result rows.
 */

// The filters a results reader accepts, mapped to the columns they compare.
// `hookName` is the hook of the job a result answers (a result's own
// `hook_name` is always `callback-received`).
const RESULT_FILTER_COLUMNS = Object.freeze({
    hookName:   "j.hook_name",
    phaseId:    "r.phase_id",
    questionId: "r.question_id",
    userId:     "r.user_id",
    groupId:    "r.group_id",
});

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function validFilters(filters) {
    if (filters === undefined || filters === null) {
        return {};
    }
    if (typeof filters !== "object" || Array.isArray(filters)) {
        throw new TypeError("Result filters must be an object.");
    }

    const unknown = Object.keys(filters).filter(key => !Object.hasOwn(RESULT_FILTER_COLUMNS, key));
    if (unknown.length > 0) {
        throw new TypeError(`Unknown result filters: ${unknown.join(", ")}.`);
    }

    const valid = {};
    for (const [key, value] of Object.entries(filters)) {
        if (value === undefined) {
            continue;
        }
        const isValid = key === "hookName"
            ? typeof value === "string" && value.length > 0
            : isPositiveInteger(value);
        if (!isValid) {
            throw new TypeError(`Result filter ${key} must be ${
                key === "hookName" ? "a hook name" : "a positive integer"}.`);
        }
        valid[key] = value;
    }
    return valid;
}

function resultFromRow(row) {
    return Object.freeze({
        id:            row.id,
        jobId:         row.job_id ?? null,
        hookName:      row.job_hook_name ?? null,
        status:        row.status,
        phaseId:       row.phase_id ?? null,
        questionId:    row.question_id ?? null,
        groupId:       row.group_id ?? null,
        userId:        row.user_id ?? null,
        // The response or chat message the job processed, recorded by #946.
        // Until then no job records it.
        source:        null,
        rawPayload:    row.raw_payload ?? null,
        adapterResult: row.adapter_result ?? null,
        receivedAt:    row.received_at instanceof Date
            ? row.received_at.toISOString()
            : row.received_at ?? null,
    });
}

export class ExternalServiceReportResultsService {
    constructor({ dbQuery } = {}) {
        this._db = dbQuery || poolQuery;
    }

    /**
     * The ids of the services with at least one job (hook or room) in the
     * session.
     * @returns {Promise<string[]>}
     */
    async listSessionServiceIds(sessionId) {
        const rows = await this._db(
            `SELECT DISTINCT service_id
             FROM external_service_jobs
             WHERE session_id = $1`,
            [sessionId]
        );
        return rows.map(row => row.service_id);
    }

    /**
     * One service's results for one session, oldest first. Unconsumed
     * (`pending`) results are left out: no handler ever processed them.
     * @returns {Promise<Object[]>} Raw rows.
     */
    async listResults({ serviceId, sessionId, filters = {} }) {
        const clauses = ["r.service_id = $1", "r.session_id = $2", "r.status <> $3"];
        const params  = [serviceId, sessionId, RESULT_STATUS.PENDING];
        for (const [key, value] of Object.entries(filters)) {
            params.push(value);
            clauses.push(`${RESULT_FILTER_COLUMNS[key]} = $${params.length}`);
        }

        return this._db(
            `SELECT r.id, r.job_id, r.service_id, r.session_id, r.status,
                    r.phase_id, r.question_id, r.group_id, r.user_id,
                    r.raw_payload, r.adapter_result, r.received_at,
                    j.hook_name AS job_hook_name
             FROM external_service_results r
             LEFT JOIN external_service_jobs j ON j.id = r.job_id
             WHERE ${clauses.join(" AND ")}
             ORDER BY r.received_at ASC, r.id ASC`,
            params
        );
    }
}

/**
 * The results reader a `report-building` handler receives: the only data
 * access it gets, bound to its own service and the report's session.
 *
 * `list({ hookName?, phaseId?, questionId?, userId?, groupId? })` resolves to
 * frozen `{ id, jobId, hookName, status, phaseId, questionId, groupId, userId,
 * source, rawPayload, adapterResult, receivedAt }`, oldest first. Unknown or
 * malformed filters reject with a TypeError.
 */
export function createReportResultsReader(store, { serviceId, sessionId }) {
    return Object.freeze({
        async list(filters) {
            const rows = await store.listResults({
                serviceId,
                sessionId,
                filters: validFilters(filters),
            });
            // The query is already scoped; this guards the scope against a
            // store that is not.
            return rows
                .filter(row => row.service_id === serviceId && Number(row.session_id) === sessionId)
                .map(resultFromRow);
        },
    });
}

export const externalServiceReportResultsService = new ExternalServiceReportResultsService();
