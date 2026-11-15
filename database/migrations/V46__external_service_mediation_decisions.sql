-- Mediation decisions of AI services (epic ethicapp-ai-additions#293,
-- sub-issue #1222).
--
-- Design notes:
--
-- A chat mediation agent that does not speak in the chat, such as Polyadic's
-- Validator in the contentCoverage mode, decides window by window whether
-- the agent that speaks should intervene. Each decision is a
-- `mediation-decision/v1` record (canonical-schemas/ai-additions/), which
-- Polyadic sends in its room callback's `decisions` list. EthicApp stores
-- the records here and exports them in the chat transcript, so evaluators
-- can analyse the agent's behavior without EthicApp.
--
-- One row per record:
--
-- - service_id is the EthicApp manifest id of the service whose callback
--   carried the record. decision_id is the record's own `decisionId`; the
--   pair is unique, so a callback delivered twice stores each decision once
--   (INSERT ... ON CONFLICT DO NOTHING).
-- - session_id, phase_id, question_id and group_id place the record in the
--   room it was decided for, as the callback's destination places the
--   room's chat messages. job_id is the job the callback correlated with (the
--   room job of the room, #833), result_id the external_service_results row
--   of the callback. A result deleted later keeps its decisions.
-- - record is the validated record, verbatim. Only records that validate
--   against the schema copy are stored.
-- - window_chat_message_ids are EthicApp's chat message ids of the window's
--   messages, in the record's order, resolved when the record is stored
--   from each reference's correlationId (the chat-message-received job whose
--   source is the message, V38); NULL where a reference cannot be resolved.
--   intervention_chat_message_id is the chat message the speaking agent
--   posted from the same callback, when it intervened.
--
-- The records carry no participant text of their own, but record->'reason'
-- is model text that may name, quote or paraphrase participants. Forgetting
-- a participant redacts it as the participant erasure redacts agent text
-- (management-console helpers/mediation-decision-erasure.js), in the record
-- here and in the callback's stored raw_payload; the erasure finds the
-- records by group_id.
--
-- No data changes.

CREATE TABLE IF NOT EXISTS external_service_mediation_decisions (
    id bigserial PRIMARY KEY,
    service_id text NOT NULL,
    decision_id uuid NOT NULL,
    session_id integer NOT NULL,
    phase_id integer NOT NULL,
    question_id integer NULL,
    group_id integer NULL,
    job_id uuid NULL
    REFERENCES external_service_jobs (id) ON DELETE SET NULL,
    result_id uuid NULL
    REFERENCES external_service_results (id) ON DELETE SET NULL,
    decided_at timestamptz NOT NULL,
    record jsonb NOT NULL,
    window_chat_message_ids bigint [] NOT NULL DEFAULT '{}',
    intervention_chat_message_id bigint NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT external_service_mediation_decisions_unique
    UNIQUE (service_id, decision_id),
    CONSTRAINT external_service_mediation_decisions_record_check
    CHECK (
        jsonb_typeof(record) = 'object'
        AND record ->> 'decisionId' = decision_id::text
    )
);

-- The report reads a service's decisions of one session.
CREATE INDEX IF NOT EXISTS idx_external_service_mediation_decisions_session
ON external_service_mediation_decisions (service_id, session_id);

-- The participant erasure finds the decisions of the groups a participant
-- wrote in.
CREATE INDEX IF NOT EXISTS idx_external_service_mediation_decisions_group
ON external_service_mediation_decisions (group_id)
WHERE group_id IS NOT NULL;
