-- Forgetting a teacher on demand (epic #879, sub-issue #877).
--
-- Design notes:
--
-- 1. Anonymization runs of teachers. The management console forgets a
-- teacher with the same per-account step as a student, in a run of one
-- account. student_anonymization_runs (V12) only allowed students; the run
-- now records which role it anonymized, `A` or `P`. The table keeps its
-- name, which the scheduled job, the runbook and the audit queries use.
--
-- 2. The target role of administrator audit events. admin_audit_events
-- (V27) names the target account by id only; `account.forget` now covers
-- students and teachers, so the row also records the role the action was
-- for. It is a one-letter code, never free text, and NULL for the actions
-- that do not record it.
--
-- 3. upload_deletion_requests: files under the protected uploads volume that
-- ethicapp must delete in the background. The console does not mount that
-- volume, so the transaction that forgets an account only records them:
-- the directories of the cases it deletes (PDF, rendered pages, manifest)
-- and the account's profile images. ethicapp, which serves the volume,
-- claims the due rows with a lease, as it does for user_erasure_requests
-- (V31), and deletes each path unless a row still references it.
--
-- path is relative to the uploads root (`cases/12`, `user-profiles/5/...`),
-- with no leading slash and no `.` or `..` segment; ethicapp checks again
-- that it resolves inside the root. recursive marks a directory.
--
-- Status vocabulary:
--
--   pending: waiting for its next attempt at next_attempt_at. attempts > 0
--            means earlier attempts failed and it is being retried.
--   done:    the path no longer exists (completed_at is set).
--   skipped: another row still references the path, so it was kept
--            (completed_at is set). A copy whose PDF copy failed, for
--            example, can point to the source case's PDF.
--   failed:  the path is not one ethicapp may delete; only an
--            administrator's retry sets it back to pending.
--
-- last_error is an upper-case code (STILL_REFERENCED, FS_EACCES, ...), never
-- a message. user_id has no foreign key, like user_erasure_requests: the
-- request must outlive any change to the account row.
--
-- 4. Indexes on the columns forgetting a teacher filters on. Finishing,
-- selecting and transferring a teacher's activities and designs filter on
-- sessions.creator and designs.creator, and the teacher's own lists use them
-- too. Deleting a case or a design checks the foreign keys of
-- pdf_render_jobs.owner_id and activity_report_exports.design_id. None of
-- them had an index.

ALTER TABLE student_anonymization_runs
DROP CONSTRAINT IF EXISTS student_anonymization_runs_target_role_check;

ALTER TABLE student_anonymization_runs
ADD CONSTRAINT student_anonymization_runs_target_role_check
CHECK (target_role IN ('A', 'P'));

ALTER TABLE admin_audit_events
ADD COLUMN IF NOT EXISTS target_role char(1);

ALTER TABLE admin_audit_events
DROP CONSTRAINT IF EXISTS admin_audit_events_target_role_check;

ALTER TABLE admin_audit_events
ADD CONSTRAINT admin_audit_events_target_role_check
CHECK (target_role IS NULL OR target_role IN ('A', 'P', 'S'));

CREATE TABLE IF NOT EXISTS upload_deletion_requests (
    id bigserial PRIMARY KEY,
    user_id integer NOT NULL,
    path text NOT NULL,
    recursive boolean NOT NULL DEFAULT FALSE,
    status varchar(16) NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_attempt_at timestamptz,
    last_error varchar(64),
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    anonymization_run_id bigint
    REFERENCES student_anonymization_runs (id) ON DELETE SET NULL,
    CONSTRAINT upload_deletion_requests_user_path_unique
    UNIQUE (user_id, path),
    CONSTRAINT upload_deletion_requests_user_id_check
    CHECK (user_id > 0),
    CONSTRAINT upload_deletion_requests_path_check
    CHECK (
        length(path) <= 512
        AND path ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+$'
        AND path !~ '(^|/)[.]{1,2}(/|$)'
    ),
    CONSTRAINT upload_deletion_requests_status_check
    CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
    CONSTRAINT upload_deletion_requests_attempts_check
    CHECK (attempts >= 0),
    CONSTRAINT upload_deletion_requests_last_error_check
    CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT upload_deletion_requests_completed_check
    CHECK ((status IN ('done', 'skipped')) = (completed_at IS NOT NULL))
);

-- The processor's claim: the pending requests that are due.
CREATE INDEX IF NOT EXISTS idx_upload_deletion_requests_due
ON upload_deletion_requests (next_attempt_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sessions_creator
ON sessions (creator);

CREATE INDEX IF NOT EXISTS idx_designs_creator
ON designs (creator);

CREATE INDEX IF NOT EXISTS idx_pdf_render_jobs_owner_id
ON pdf_render_jobs (owner_id);

CREATE INDEX IF NOT EXISTS idx_activity_report_exports_design_id
ON activity_report_exports (design_id)
WHERE design_id IS NOT NULL;
