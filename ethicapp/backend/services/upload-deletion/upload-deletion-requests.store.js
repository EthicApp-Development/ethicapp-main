import {
    COMMON_REQUEST_COLUMNS,
    commonRequestFields,
    LeasedRequestStore,
} from "../leased-queue/leased-request-store.js";

/**
 * Access to upload_deletion_requests (V32, #877): the files under the
 * protected uploads volume that forgetting an account freed (the directories
 * of the cases it deleted, the account's profile images). The management
 * console records them when it forgets the account; this store claims the
 * due ones and records each attempt's outcome. Besides the statuses of
 * LeasedRequestStore, a request can end `skipped`: the path was kept because
 * a row still references it.
 */

export const UPLOAD_DELETION_STATUS = Object.freeze({
    PENDING: "pending",
    DONE:    "done",
    SKIPPED: "skipped",
    FAILED:  "failed",
});

const CASE_PATH_PATTERN = /^cases\/([1-9][0-9]{0,9})(\/|$)/;

function toRequest(row) {
    return { ...commonRequestFields(row), path: row.path, recursive: row.recursive === true };
}

// The spellings a stored column may use for a path relative to the uploads
// root, as the protected uploads controller accepts them.
export function storedPathCandidates(relativePath) {
    return [
        `uploads/${relativePath}`,
        `/uploads/${relativePath}`,
        `assets/uploads/${relativePath}`,
        `/assets/uploads/${relativePath}`,
    ];
}

// The case whose files a path holds (`cases/<id>` or a path inside it), or
// null. A case's rendered pages are found by its id, not by a stored path.
export function caseIdOfPath(relativePath) {
    const match = CASE_PATH_PATTERN.exec(relativePath);
    const caseId = match ? Number(match[1]) : null;
    return caseId && caseId <= 2147483647 ? caseId : null;
}

// Whether a row still points at the path (or, for a directory, at a path
// inside it): every column that stores an upload path, and the case that
// owns a `cases/<id>` path.
export const STILL_REFERENCED_SQL = `
    SELECT (
        EXISTS (
            SELECT 1
            FROM unnest($1::text[]) AS candidate (stored_path)
            JOIN (
                SELECT pdf_path AS stored_path FROM ethical_cases
                UNION ALL
                SELECT source_path FROM pdf_render_jobs
                UNION ALL
                SELECT manifest_path FROM pdf_render_jobs
                UNION ALL
                SELECT profile_image_path FROM users
                UNION ALL
                SELECT profile_image_topbar_path FROM users
            ) AS reference
              ON reference.stored_path = candidate.stored_path
              OR ($2::boolean AND starts_with(reference.stored_path, candidate.stored_path || '/'))
        )
        OR EXISTS (
            SELECT 1
            FROM ethical_cases
            WHERE id = $3::integer
        )
    ) AS referenced
`;

export class UploadDeletionRequestsStore extends LeasedRequestStore {
    /**
     * @param {Object} [options]
     * @param {(sql: string, params: unknown[]) => Promise<object[]>} [options.dbQuery]
     *     Runs one statement and resolves to its rows.
     */
    constructor({ dbQuery } = {}) {
        super({
            table:             "upload_deletion_requests",
            columns:           [...COMMON_REQUEST_COLUMNS, "path", "recursive"],
            toRequest,
            listOrder:         "path",
            completedStatuses: [UPLOAD_DELETION_STATUS.DONE, UPLOAD_DELETION_STATUS.SKIPPED],
            dbQuery,
        });
    }

    /**
     * Whether a row still references the request's path.
     * @param {{ path: string, recursive: boolean }} request
     * @returns {Promise<boolean>}
     */
    async isStillReferenced({ path, recursive }) {
        const rows = await this._db(STILL_REFERENCED_SQL, [
            storedPathCandidates(path),
            Boolean(recursive),
            caseIdOfPath(path),
        ]);
        return rows[0]?.referenced === true;
    }

    /**
     * The user's deletions by status, for the console: { total, pending,
     * retrying, done, skipped, failed, lastError }. `pending` counts those
     * not attempted yet, `retrying` the pending ones that failed before;
     * `lastError` is the latest error code of a request not complete.
     */
    async summaryForUser(userId) {
        const rows = await this._db(
            `SELECT count(*)::integer AS total,
                    count(*) FILTER (
                        WHERE status = 'pending' AND attempts = 0
                    )::integer AS pending,
                    count(*) FILTER (
                        WHERE status = 'pending' AND attempts > 0
                    )::integer AS retrying,
                    count(*) FILTER (WHERE status = 'done')::integer AS done,
                    count(*) FILTER (WHERE status = 'skipped')::integer AS skipped,
                    count(*) FILTER (WHERE status = 'failed')::integer AS failed,
                    (
                        SELECT last_error
                        FROM upload_deletion_requests
                        WHERE user_id = $1
                          AND status IN ('pending', 'failed')
                          AND last_error IS NOT NULL
                        ORDER BY last_attempt_at DESC NULLS LAST, id DESC
                        LIMIT 1
                    ) AS last_error
             FROM upload_deletion_requests
             WHERE user_id = $1`,
            [userId]
        );
        const row = rows[0] ?? {};
        return {
            total:     Number(row.total ?? 0),
            pending:   Number(row.pending ?? 0),
            retrying:  Number(row.retrying ?? 0),
            done:      Number(row.done ?? 0),
            skipped:   Number(row.skipped ?? 0),
            failed:    Number(row.failed ?? 0),
            lastError: row.last_error ?? null,
        };
    }
}

export const uploadDeletionRequestsStore = new UploadDeletionRequestsStore();
