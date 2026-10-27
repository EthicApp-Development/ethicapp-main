-- Results of design-scoped external services (design analyses, epic #846).
--
-- Design notes:
--
-- design_analyses keeps one row per design and service, holding the current
-- result of that service for the design, like case_analyses does for cases.
-- service_id is the manifest adapter id. Analyses never go into the design
-- document (designs.design): the design schema does not change.
--
-- Rows are created by the first reservation of a generation for the design and
-- service, and a new generation replaces the previous document when its result
-- arrives. Deleting the design deletes its analyses.
--
-- The document follows the schema named in document_schema, which its service
-- declares (for example claim-typology/v1). Raw callbacks stay in
-- external_service_results for audit; this table only keeps the current result.
--
-- Status vocabulary (the same as case_analyses):
--
--   requested:  a generation is reserved under job_id and its adapter has not
--               started it.
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
--
-- input_hash is the hash of the input (computed by the service's adapter) that
-- produced the latest generation, reserved, in flight or finished. A save
-- whose input has the same hash needs no new generation. NULL when the
-- generation was requested without one. requested_at and requested_by
-- describe the request of that latest generation too, because generations of
-- a design are requested again and again (on save and on regenerate).

CREATE TABLE IF NOT EXISTS design_analyses (
    design_id integer NOT NULL,
    service_id text NOT NULL,
    status text NOT NULL DEFAULT 'requested'
    CONSTRAINT design_analyses_status_check
    CHECK (status IN ('requested', 'processing', 'ready', 'failed')),
    document_schema text NULL,
    document jsonb NULL, -- noqa: RF04
    input_hash text NULL,
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
    PRIMARY KEY (design_id, service_id),
    CONSTRAINT design_analyses_design_fkey
    FOREIGN KEY (design_id) REFERENCES designs (id)
    ON DELETE CASCADE,
    CONSTRAINT design_analyses_requester_fkey
    FOREIGN KEY (requested_by) REFERENCES users (id)
    ON DELETE SET NULL,
    CONSTRAINT design_analyses_reviewer_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_design_analyses_job_id
ON design_analyses (job_id)
WHERE job_id IS NOT NULL;
