/**
 * The statements that move a PDF render job between its states, apart from
 * the worker (which connects to the database when it is loaded), so that
 * they can be tested against PostgreSQL.
 *
 * metadata.rerenderRequested marks a job whose result is stale before it is
 * done: the management console sets it on a job a worker is processing when
 * it erases the case's author email (#877), because the worker already read
 * the case. Completing a flagged job queues it again instead, with a fresh
 * attempt count, so the case is rendered once more after this worker has
 * stopped writing its files. Claiming a job clears the flag, since the
 * worker that claims it reads the case afterwards.
 */

export const RERENDER_REQUESTED_KEY = "rerenderRequested";

export const CLAIM_NEXT_JOB_SQL = `
    WITH next_job AS (
        SELECT id
        FROM pdf_render_jobs
        WHERE status = 'pending'
          AND next_attempt_at <= now()
          AND attempt_count < max_attempts
        ORDER BY requested_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE pdf_render_jobs AS job
    SET status = 'processing',
        started_at = now(),
        completed_at = NULL,
        error_message = NULL,
        attempt_count = job.attempt_count + 1,
        metadata = job.metadata - '${RERENDER_REQUESTED_KEY}'
    FROM next_job
    WHERE job.id = next_job.id
    RETURNING job.*;
`;

const FLAGGED = `metadata ? '${RERENDER_REQUESTED_KEY}'`;

// $1 job id, $2 page count, $3 manifest path, $4 metadata to merge.
export const MARK_JOB_COMPLETED_SQL = `
    UPDATE pdf_render_jobs
    SET status = CASE WHEN ${FLAGGED} THEN 'pending' ELSE 'completed' END,
        completed_at = CASE WHEN ${FLAGGED} THEN NULL ELSE now() END,
        started_at = CASE WHEN ${FLAGGED} THEN NULL ELSE started_at END,
        attempt_count = CASE WHEN ${FLAGGED} THEN 0 ELSE attempt_count END,
        next_attempt_at = now(),
        page_count = $2,
        manifest_path = $3,
        error_message = NULL,
        metadata = (metadata || $4::jsonb) - '${RERENDER_REQUESTED_KEY}'
    WHERE id = $1
    RETURNING status;
`;
