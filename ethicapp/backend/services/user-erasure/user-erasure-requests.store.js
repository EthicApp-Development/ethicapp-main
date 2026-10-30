import { poolQuery } from "../external-service-jobs.service.js";

/**
 * Access to user_erasure_requests (V31, #876): one row per forgotten account
 * and AI Additions service. The management console records the rows when it
 * anonymizes an account; this store claims the due ones and records each
 * attempt's outcome.
 *
 * Statuses: `pending` (waiting for next_attempt_at; attempts > 0 means it is
 * being retried), `done`, `failed` (a retry cannot fix it; only an
 * administrator's retry sets it back to pending). `last_error` holds an
 * upper-case code, never a message.
 */

export const ERASURE_REQUEST_STATUS = Object.freeze({
    PENDING: "pending",
    DONE:    "done",
    FAILED:  "failed",
});

const REQUEST_COLUMNS = `id, user_id, service_id, status, attempts, next_attempt_at,
    last_attempt_at, last_error, requested_at, completed_at`;

function toRequest(row) {
    return {
        id:            Number(row.id),
        userId:        Number(row.user_id),
        serviceId:     row.service_id,
        status:        row.status,
        attempts:      Number(row.attempts),
        nextAttemptAt: row.next_attempt_at ?? null,
        lastAttemptAt: row.last_attempt_at ?? null,
        lastError:     row.last_error ?? null,
        requestedAt:   row.requested_at ?? null,
        completedAt:   row.completed_at ?? null,
    };
}

export class UserErasureRequestsStore {
    /**
     * @param {Object} [options]
     * @param {(sql: string, params: unknown[]) => Promise<object[]>} [options.dbQuery]
     *     Runs one statement and resolves to its rows.
     */
    constructor({ dbQuery } = {}) {
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
            `UPDATE user_erasure_requests
             SET next_attempt_at = now() + ($2::bigint * interval '1 millisecond'),
                 last_attempt_at = now()
             WHERE id IN (
                 SELECT id
                 FROM user_erasure_requests
                 WHERE status = 'pending'
                   AND next_attempt_at <= now()
                   AND ($3::integer IS NULL OR user_id = $3::integer)
                 ORDER BY next_attempt_at, id
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED
             )
             RETURNING ${REQUEST_COLUMNS}`,
            [limit, leaseMs, userId]
        );
        return rows.map(toRequest);
    }

    // The service confirmed the erasure.
    async markDone(requestId) {
        await this._db(
            `UPDATE user_erasure_requests
             SET status = 'done',
                 attempts = attempts + 1,
                 last_error = NULL,
                 completed_at = now()
             WHERE id = $1
               AND status = 'pending'`,
            [requestId]
        );
    }

    // The attempt failed and may succeed later: next attempt in `delayMs`.
    async markRetry(requestId, errorCode, delayMs) {
        await this._db(
            `UPDATE user_erasure_requests
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
            `UPDATE user_erasure_requests
             SET status = 'failed',
                 attempts = attempts + 1,
                 last_error = $2
             WHERE id = $1
               AND status = 'pending'`,
            [requestId, errorCode]
        );
    }

    // The requests of one user, by service id.
    async listForUser(userId) {
        const rows = await this._db(
            `SELECT ${REQUEST_COLUMNS}
             FROM user_erasure_requests
             WHERE user_id = $1
             ORDER BY service_id`,
            [userId]
        );
        return rows.map(toRequest);
    }

    /**
     * An administrator's retry: every request of the user that is not done
     * becomes pending and due now, with a fresh backoff (attempts = 0). The
     * last error is kept until the next attempt.
     * @returns {Promise<number>} How many requests were reset.
     */
    async resetForRetry(userId) {
        const rows = await this._db(
            `UPDATE user_erasure_requests
             SET status = 'pending',
                 attempts = 0,
                 next_attempt_at = now()
             WHERE user_id = $1
               AND status <> 'done'
             RETURNING id`,
            [userId]
        );
        return rows.length;
    }
}

export const userErasureRequestsStore = new UserErasureRequestsStore();
