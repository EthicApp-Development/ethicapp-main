-- External-service job and callback result tracking.
--
-- Design notes:
--
-- external_service_jobs represents one outbound dispatch unit of work: EthicApp
-- calling an adapter for a specific hook. The job id (UUID) is the single
-- stable correlation identifier sent to external providers in outbound requests.
-- There is no separate correlationId column; job.id IS the correlation id.
--
-- external_service_results represents one inbound callback. correlation_id
-- stores the raw value returned by the provider. job_id is the resolved FK
-- (set when correlation_id matches a known job). Both columns are nullable and
-- stored independently so unrecognized or uncorrelated callbacks remain auditable.
--
-- Status vocabulary:
--
--   Jobs:    pending | dispatched | callback-received | completed | failed | skipped | expired
--   Results: callback-received | completed | failed | unknown-correlation
--
-- Jobs progress from pending → dispatched → callback-received → completed/failed.
-- skipped: adapter determined at dispatch time that no provider call was needed.
-- expired: job timed out before a callback arrived.
-- unknown-correlation: result arrived with a correlation_id that matched no job.

CREATE TABLE IF NOT EXISTS external_service_jobs (
    id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
    service_id         text        NOT NULL,
    hook_name          text        NOT NULL,
    status             text        NOT NULL DEFAULT 'pending'
                           CONSTRAINT external_service_jobs_status_check
                           CHECK (status IN (
                               'pending',
                               'dispatched',
                               'callback-received',
                               'completed',
                               'failed',
                               'skipped',
                               'expired'
                           )),
    session_id         integer     NULL,
    phase_id           integer     NULL,
    question_id        integer     NULL,
    group_id           integer     NULL,
    user_id            integer     NULL,
    outbound_payload   jsonb       NULL,
    provider_reference text        NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    dispatched_at      timestamptz NULL,
    completed_at       timestamptz NULL,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_service_id
    ON external_service_jobs(service_id);

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_status
    ON external_service_jobs(status);

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_created_at
    ON external_service_jobs(created_at);

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_session_id
    ON external_service_jobs(session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_service_jobs_phase_id
    ON external_service_jobs(phase_id)
    WHERE phase_id IS NOT NULL;

-- Partial index for active (non-terminal) jobs: supports background polling
-- or expiry sweeps without scanning completed/failed/skipped rows.
CREATE INDEX IF NOT EXISTS idx_external_service_jobs_active
    ON external_service_jobs(service_id, created_at)
    WHERE status IN ('pending', 'dispatched', 'callback-received');


CREATE TABLE IF NOT EXISTS external_service_results (
    id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
    job_id             uuid        NULL
                           CONSTRAINT external_service_results_job_id_fkey
                           REFERENCES external_service_jobs(id),
    correlation_id     text        NULL,
    service_id         text        NOT NULL,
    hook_name          text        NOT NULL DEFAULT 'callback-received',
    status             text        NOT NULL DEFAULT 'callback-received'
                           CONSTRAINT external_service_results_status_check
                           CHECK (status IN (
                               'callback-received',
                               'completed',
                               'failed',
                               'unknown-correlation'
                           )),
    session_id         integer     NULL,
    phase_id           integer     NULL,
    question_id        integer     NULL,
    group_id           integer     NULL,
    user_id            integer     NULL,
    raw_payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    sanitized_payload  jsonb       NULL,
    adapter_result     jsonb       NULL,
    received_at        timestamptz NOT NULL DEFAULT now(),
    processed_at       timestamptz NULL,
    PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_external_service_results_job_id
    ON external_service_results(job_id)
    WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_service_results_correlation_id
    ON external_service_results(correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_service_results_service_id
    ON external_service_results(service_id);

CREATE INDEX IF NOT EXISTS idx_external_service_results_status
    ON external_service_results(status);

CREATE INDEX IF NOT EXISTS idx_external_service_results_received_at
    ON external_service_results(received_at);

CREATE INDEX IF NOT EXISTS idx_external_service_results_session_id
    ON external_service_results(session_id)
    WHERE session_id IS NOT NULL;
