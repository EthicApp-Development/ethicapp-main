-- Topic coverage of mediation decisions (#1233, epic
-- ethicapp-ai-additions#312).
--
-- Design notes:
--
-- A `mediation-decision/v1` record may carry the room's topic coverage as
-- the deciding agent saw it, the optional `topicCoverage` key
-- (ethicapp-ai-additions#313): each topic of the room with its level and the
-- participant messages cited as evidence, as references like those of
-- `window.messages`. The record, the coverage included, is already stored
-- verbatim in external_service_mediation_decisions.record (V46).
--
-- coverage_evidence_chat_message_ids keeps EthicApp's chat message ids of
-- the evidence, resolved when the record is stored as the window's are
-- (window_chat_message_ids): from each reference's correlationId, the
-- chat-message-received job whose source is the message (V38), among the
-- service's jobs of the session. It is a JSON array aligned with
-- record->'topicCoverage'->'topics', each element an array aligned with
-- that topic's `evidence`, holding a chat message id or null where a
-- reference cannot be resolved: [[5101, 5104], [], [null]]. A JSON array of
-- arrays is used because the topics hold different numbers of references,
-- which a bigint[] cannot.
--
-- The column is set exactly when the record has a coverage; records without
-- one keep NULL, as every row stored before this migration does.
--
-- The coverage holds topic ids and message references only, never
-- participant or model text, so the participant erasure needs nothing new.
--
-- No data changes.

ALTER TABLE external_service_mediation_decisions
ADD COLUMN coverage_evidence_chat_message_ids jsonb NULL,
ADD CONSTRAINT external_service_mediation_decisions_coverage_check
CHECK (
    (
        (record -> 'topicCoverage') IS NOT NULL
        AND coverage_evidence_chat_message_ids IS NOT NULL
        AND jsonb_typeof(coverage_evidence_chat_message_ids) = 'array'
    )
    OR (
        (record -> 'topicCoverage') IS NULL
        AND coverage_evidence_chat_message_ids IS NULL
    )
);
