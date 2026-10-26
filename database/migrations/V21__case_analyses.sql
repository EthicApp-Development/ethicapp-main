-- Results of case-scoped external services (case analyses).
--
-- Design notes:
--
-- case_analyses keeps one row per case and chosen service, holding the current
-- result of that service for the case. Teachers choose the services when they
-- create the case (POST /cases): one 'requested' row is inserted per choice,
-- and case-created is dispatched only to those services. Editing the case
-- never adds or removes rows.
--
-- The document follows the schema named in document_schema, which its service
-- declares (for example evidence-inventory/v1). Raw callbacks stay in
-- external_service_results for audit; this table only keeps the current result.
--
-- Status vocabulary (generic; service-specific states such as "reviewed" live
-- in the document or in the review columns):
--
--   requested:  chosen at case creation; no generation has started. A row that
--               stays here, for example after a restart, can be generated again.
--   processing: a generation is in flight; job_id identifies it.
--   ready:      document holds the latest result.
--   failed:     the latest generation failed and there is no document.
--
-- A new generation keeps the previous document until its result arrives. A
-- failed generation keeps an existing document (the status stays 'ready'), and
-- only error_code and error_message record the failure.
--
-- job_id is the external-service correlation id of the latest generation.
-- Results only apply when they match it, which discards superseded
-- generations. It has no foreign key to external_service_jobs, because a
-- generation can still run when its job row could not be created.

CREATE TABLE IF NOT EXISTS case_analyses (
    case_id integer NOT NULL,
    service_id text NOT NULL,
    status text NOT NULL DEFAULT 'requested'
    CONSTRAINT case_analyses_status_check
    CHECK (status IN ('requested', 'processing', 'ready', 'failed')),
    document_schema text NULL,
    document jsonb NULL, -- noqa: RF04
    job_id uuid NULL,
    error_code text NULL,
    error_message text NULL,
    requested_by integer NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    generated_at timestamptz NULL,
    reviewed_by integer NULL,
    reviewed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id, service_id),
    CONSTRAINT case_analyses_case_fkey
    FOREIGN KEY (case_id) REFERENCES ethical_cases (id)
    ON DELETE CASCADE,
    CONSTRAINT case_analyses_requester_fkey
    FOREIGN KEY (requested_by) REFERENCES users (id)
    ON DELETE SET NULL,
    CONSTRAINT case_analyses_reviewer_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_case_analyses_job_id
ON case_analyses (job_id)
WHERE job_id IS NOT NULL;
