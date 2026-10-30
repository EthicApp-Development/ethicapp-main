-- Forgetting a student on demand (epic #879, sub-issue #876).
--
-- Design notes:
--
-- 1. Indexes on the columns the anonymization filters on. The per-account
-- step updates every row a student wrote, by user id, in four response
-- tables and in the AI service job and result tables. None of those columns
-- had an index, so each update scanned its whole table, once per student.
-- The external service tables keep many rows without a user (case, design
-- and group work), so their indexes are partial.
--
-- 2. user_erasure_requests: one row per account and AI Additions service
-- that must be asked to erase what it keeps about the account. The
-- management console writes the rows in the transaction that anonymizes the
-- account, both on demand and in the scheduled job; ethicapp, which holds
-- the AI Additions credentials, processes them in the background through the
-- `user-forgotten` hook and records the outcome here.
--
-- service_id is an AI Additions service id (`argumentation-tutor`,
-- `polyadic-agent`): the data lives in the service, whatever adapter sent
-- it. Ids are checked by format, so a later service needs no migration.
--
-- Status vocabulary:
--
--   pending: waiting for its next attempt at next_attempt_at. attempts > 0
--            means earlier attempts failed and it is being retried, with a
--            backoff that ethicapp computes from attempts.
--   done:    the service confirmed the erasure (completed_at is set).
--   failed:  the service refused the request in a way a retry cannot fix.
--            Only an administrator's retry sets it back to pending.
--
-- last_error is an upper-case code (UNREACHABLE, HTTP_503, ...), never a
-- message, so no free text can carry personal data.
--
-- user_id has no foreign key, like admin_audit_events (V27): an erasure
-- that AI Additions still owes must outlive any later change to the
-- account row.

CREATE INDEX IF NOT EXISTS idx_differential_selection_uid
ON differential_selection (uid);

CREATE INDEX IF NOT EXISTS idx_differential_chat_uid
ON differential_chat (uid);

CREATE INDEX IF NOT EXISTS idx_chat_uid
ON chat (uid);

CREATE INDEX IF NOT EXISTS idx_actor_selection_uid
ON actor_selection (uid);

CREATE INDEX IF NOT EXISTS idx_external_service_results_user_id
ON external_service_results (user_id)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_user_id
ON external_service_jobs (user_id)
WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_erasure_requests (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL,
    service_id varchar(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_attempt_at timestamptz,
    last_error varchar(64),
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    anonymization_run_id bigint
    REFERENCES student_anonymization_runs (id) ON DELETE SET NULL,
    CONSTRAINT user_erasure_requests_user_service_unique
    UNIQUE (user_id, service_id),
    CONSTRAINT user_erasure_requests_user_id_check
    CHECK (user_id > 0),
    CONSTRAINT user_erasure_requests_service_id_check
    CHECK (service_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
    CONSTRAINT user_erasure_requests_status_check
    CHECK (status IN ('pending', 'done', 'failed')),
    CONSTRAINT user_erasure_requests_attempts_check
    CHECK (attempts >= 0),
    CONSTRAINT user_erasure_requests_last_error_check
    CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT user_erasure_requests_completed_check
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

-- The processor's claim: the pending requests that are due.
CREATE INDEX IF NOT EXISTS idx_user_erasure_requests_due
ON user_erasure_requests (next_attempt_at)
WHERE status = 'pending';
