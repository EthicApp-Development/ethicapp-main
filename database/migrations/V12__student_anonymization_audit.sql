CREATE TABLE IF NOT EXISTS student_anonymization_runs (
    id bigserial PRIMARY KEY,
    status varchar(30) NOT NULL DEFAULT 'running',
    dry_run boolean NOT NULL DEFAULT false,
    placeholder_text text NOT NULL DEFAULT '******',
    target_role char(1) NOT NULL DEFAULT 'A',
    total_accounts integer NOT NULL DEFAULT 0,
    succeeded_accounts integer NOT NULL DEFAULT 0,
    failed_accounts integer NOT NULL DEFAULT 0,
    started_at timestamp with time zone NOT NULL DEFAULT NOW(),
    finished_at timestamp with time zone,
    triggered_by text,
    process_name text,
    notes text,
    CONSTRAINT student_anonymization_runs_status_check
        CHECK (status IN ('running', 'completed', 'completed_with_failures', 'failed')),
    CONSTRAINT student_anonymization_runs_target_role_check
        CHECK (target_role = 'A'),
    CONSTRAINT student_anonymization_runs_totals_check
        CHECK (
            total_accounts >= 0
            AND succeeded_accounts >= 0
            AND failed_accounts >= 0
            AND succeeded_accounts + failed_accounts <= total_accounts
        )
);

CREATE TABLE IF NOT EXISTS student_anonymization_events (
    id bigserial PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES student_anonymization_runs(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status varchar(30) NOT NULL,
    message text,
    error_code text,
    error_detail text,
    started_at timestamp with time zone NOT NULL DEFAULT NOW(),
    finished_at timestamp with time zone,
    CONSTRAINT student_anonymization_events_status_check
        CHECK (status IN ('started', 'skipped', 'succeeded', 'failed')),
    CONSTRAINT student_anonymization_events_run_user_unique
        UNIQUE (run_id, user_id)
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS anonymized_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS anonymization_run_id bigint
    REFERENCES student_anonymization_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_student_anonymization_runs_status
    ON student_anonymization_runs(status);

CREATE INDEX IF NOT EXISTS idx_student_anonymization_events_run_id
    ON student_anonymization_events(run_id);

CREATE INDEX IF NOT EXISTS idx_student_anonymization_events_user_id
    ON student_anonymization_events(user_id);

CREATE INDEX IF NOT EXISTS idx_users_anonymization_run_id
    ON users(anonymization_run_id);

CREATE INDEX IF NOT EXISTS idx_users_student_anonymization_candidates
    ON users(id)
    WHERE role = 'A' AND anonymized_at IS NULL;
