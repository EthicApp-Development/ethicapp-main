CREATE TABLE IF NOT EXISTS pdf_render_jobs (
    id serial PRIMARY KEY,
    owner_type text NOT NULL CHECK (owner_type IN ('case')),
    owner_id integer NOT NULL,
    source_path text NOT NULL,
    source_sha256 text,
    source_byte_count bigint,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    page_count integer,
    manifest_path text,
    error_message text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT pdf_render_jobs_owner_unique UNIQUE (owner_type, owner_id),
    CONSTRAINT pdf_render_jobs_case_owner_fkey
        FOREIGN KEY (owner_id) REFERENCES ethical_cases(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pdf_render_jobs_pending
    ON pdf_render_jobs(next_attempt_at, requested_at, id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pdf_render_jobs_status
    ON pdf_render_jobs(status);

CREATE INDEX IF NOT EXISTS idx_pdf_render_jobs_source_sha256
    ON pdf_render_jobs(source_sha256);
