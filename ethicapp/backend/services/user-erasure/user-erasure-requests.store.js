import {
    COMMON_REQUEST_COLUMNS,
    commonRequestFields,
    LeasedRequestStore,
} from "../leased-queue/leased-request-store.js";

/**
 * Access to user_erasure_requests (V31, #876): one row per forgotten account
 * and AI Additions service. The management console records the rows when it
 * anonymizes an account; this store claims the due ones and records each
 * attempt's outcome (see LeasedRequestStore for the statuses and the lease).
 */

export const ERASURE_REQUEST_STATUS = Object.freeze({
    PENDING: "pending",
    DONE:    "done",
    FAILED:  "failed",
});

function toRequest(row) {
    return { ...commonRequestFields(row), serviceId: row.service_id };
}

export class UserErasureRequestsStore extends LeasedRequestStore {
    /**
     * @param {Object} [options]
     * @param {(sql: string, params: unknown[]) => Promise<object[]>} [options.dbQuery]
     *     Runs one statement and resolves to its rows.
     */
    constructor({ dbQuery } = {}) {
        super({
            table:     "user_erasure_requests",
            columns:   [...COMMON_REQUEST_COLUMNS, "service_id"],
            toRequest,
            listOrder: "service_id",
            dbQuery,
        });
    }
}

export const userErasureRequestsStore = new UserErasureRequestsStore();
