import { poolQuery } from "../external-service-jobs.service.js";

/**
 * Access to a table of background requests that ethicapp claims with a
 * lease (#876, #877): user_erasure_requests (V31) and
 * upload_deletion_requests (V32). Both have the columns `id`, `user_id`,
 * `status`, `attempts`, `next_attempt_at`, `last_attempt_at`, `last_error`,
 * `requested_at` and `completed_at`, and the statuses `pending` (waiting for
 * next_attempt_at; attempts > 0 means it is being retried), `done` and
 * `failed` (a retry cannot fix it; only an administrator's retry sets it back
 * to pending). `last_error` holds an upper-case code, never a message.
 *
 * Subclasses name the table, the columns they read and how a row becomes a
 * request.
 */

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

export const COMMON_REQUEST_COLUMNS = Object.freeze([
    "id", "user_id", "status", "attempts", "next_attempt_at", "last_attempt_at", "last_error",
    "requested_at", "completed_at",
]);

/**
 * The fields every request has, from its row.
 * @param {object} row
 */
export function commonRequestFields(row) {
    return {
        id:            Number(row.id),
        userId:        Number(row.user_id),
        status:        row.status,
        attempts:      Number(row.attempts),
        nextAttemptAt: row.next_attempt_at ?? null,
        lastAttemptAt: row.last_attempt_at ?? null,
        lastError:     row.last_error ?? null,
        requestedAt:   row.requested_at ?? null,
        completedAt:   row.completed_at ?? null,
    };
}

export class LeasedRequestStore {
    /**
     * @param {Object} options
     * @param {string} options.table - The table (a plain identifier).
     * @param {string[]} options.columns - Columns read for a request.
     * @param {(row: object) => object} options.toRequest
     * @param {string} [options.listOrder] - ORDER BY of listForUser.
     * @param {string[]} [options.completedStatuses] - Statuses a retry
     *     leaves alone.
     * @param {(sql: string, params: unknown[]) => Promise<object[]>} [options.dbQuery]
     *     Runs one statement and resolves to its rows.
     */
    constructor({
        table,
        columns,
        toRequest,
        listOrder = "id",
        completedStatuses = ["done"],
        dbQuery,
    }) {
        for (const identifier of [table, ...columns, ...listOrder.split(/\s*,\s*/)]) {
            if (!IDENTIFIER_PATTERN.test(identifier)) {
                throw new TypeError(`Invalid identifier: ${identifier}`);
            }
        }

        this._table = table;
        this._columns = columns.join(", ");
        this._toRequest = toRequest;
        this._listOrder = listOrder;
        this._completedStatuses = [...completedStatuses];
        this._db = dbQuery || poolQuery;
    }

    /**
     * Claims up to `limit` due pending requests, oldest due first, optionally
     * of one user. A claim is a lease: it moves next_attempt_at `leaseMs`
     * ahead, so no other process takes the request while it is attempted,
     * and a process that dies mid-attempt leaves it due again once the lease
     * ends. Concurrent claims skip each other's rows (SKIP LOCKED).
     * @returns {Promise<object[]>} The claimed requests.
     */
    async claimDue({ limit, leaseMs, userId = null }) {
        const rows = await this._db(
            `UPDATE ${this._table}
             SET next_attempt_at = now() + ($2::bigint * interval '1 millisecond'),
                 last_attempt_at = now()
             WHERE id IN (
                 SELECT id
                 FROM ${this._table}
                 WHERE status = 'pending'
                   AND next_attempt_at <= now()
                   AND ($3::integer IS NULL OR user_id = $3::integer)
                 ORDER BY next_attempt_at, id
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING ${this._columns}`,
            [limit, leaseMs, userId]
        );
        return rows.map(this._toRequest);
    }

    // The request is complete, with `status` (`done` unless the subclass
    // has another completed status) and an optional code.
    async markCompleted(requestId, status = "done", code = null) {
        await this._db(
            `UPDATE ${this._table}
             SET status = $2,
                 attempts = attempts + 1,
                 last_error = $3,
                 completed_at = now()
             WHERE id = $1
               AND status = 'pending'`,
            [requestId, status, code]
        );
    }

    async markDone(requestId) {
        await this.markCompleted(requestId, "done");
    }

    // The attempt failed and may succeed later: next attempt in `delayMs`.
    async markRetry(requestId, errorCode, delayMs) {
        await this._db(
            `UPDATE ${this._table}
             SET attempts = attempts + 1,
                 last_error = $2,
                 next_attempt_at = now() + ($3::bigint * interval '1 millisecond')
             WHERE id = $1
               AND status = 'pending'`,
            [requestId, errorCode, delayMs]
        );
    }

    // The attempt failed in a way a retry cannot fix.
    async markFailed(requestId, errorCode) {
        await this._db(
            `UPDATE ${this._table}
             SET status = 'failed',
                 attempts = attempts + 1,
                 last_error = $2
             WHERE id = $1
               AND status = 'pending'`,
            [requestId, errorCode]
        );
    }

    // The requests of one user.
    async listForUser(userId) {
        const rows = await this._db(
            `SELECT ${this._columns}
             FROM ${this._table}
             WHERE user_id = $1
             ORDER BY ${this._listOrder}`,
            [userId]
        );
        return rows.map(this._toRequest);
    }

    /**
     * An administrator's retry: every request of the user that is not
     * complete becomes pending and due now, with a fresh backoff
     * (attempts = 0). The last error is kept until the next attempt.
     * @returns {Promise<number>} How many requests were reset.
     */
    async resetForRetry(userId) {
        const rows = await this._db(
            `UPDATE ${this._table}
             SET status = 'pending',
                 attempts = 0,
                 next_attempt_at = now()
             WHERE user_id = $1
               AND status <> ALL($2::text[])
             RETURNING id`,
            [userId, this._completedStatuses]
        );
        return rows.length;
    }
}
