-- Evidence inventories of ethical cases.
--
-- Design notes:
--
-- case_evidence_inventories stores one evidence inventory per case: the closed
-- list of case facts (EV#) that a student may invoke as evidence, and the
-- plausible statements the case does not make (EX#). The inventory document
-- follows the evidence-inventory/v1 JSON Schema owned by the Argumentation
-- Tutor in ethicapp-ai-additions
-- (argumentation-tutor/backend/modules/evidence_inventory/schemas/).
--
-- An external service drafts the inventory when the case document text is
-- ready (case-document-ready hook) and the case creator reviews it. The
-- inventory is case metadata: it belongs to EthicApp, not to the AI service.
--
-- Status vocabulary:
--
--   processing: a generation request is in flight; job_id identifies it.
--   draft:      a generated inventory waits for teacher review.
--   reviewed:   the teacher saved the inventory (reviewed_at, reviewed_by).
--   failed:     the generation failed and there is no inventory yet.
--
-- A new generation keeps the previous inventory until its result arrives; the
-- new draft then replaces it and clears its review. When a generation fails,
-- an existing inventory keeps its draft or reviewed status and only
-- error_message records the failure.
--
-- job_id is the external-service correlation id of the latest generation
-- request. Callbacks only apply when they match it, which discards results of
-- superseded requests. It has no foreign key to external_service_jobs because
-- the adapter falls back to a local id when the job row could not be created.

CREATE TABLE IF NOT EXISTS case_evidence_inventories (
    case_id integer NOT NULL,
    status text NOT NULL
    CONSTRAINT case_evidence_inventories_status_check
    CHECK (status IN ('processing', 'draft', 'reviewed', 'failed')),
    inventory jsonb NULL,
    service_id text NULL,
    job_id uuid NULL,
    error_message text NULL,
    generated_at timestamptz NULL,
    reviewed_at timestamptz NULL,
    reviewed_by integer NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id),
    CONSTRAINT case_evidence_inventories_case_fkey
    FOREIGN KEY (case_id) REFERENCES ethical_cases (id)
    ON DELETE CASCADE,
    CONSTRAINT case_evidence_inventories_reviewer_fkey
    FOREIGN KEY (reviewed_by) REFERENCES users (id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_case_evidence_inventories_job_id
ON case_evidence_inventories (job_id)
WHERE job_id IS NOT NULL;
