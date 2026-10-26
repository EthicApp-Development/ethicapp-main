-- Retryable callback results (#815).
--
-- A callback is recorded in external_service_results before EthicApp decides
-- where it may publish. When that decision fails for a transient reason (a
-- lookup of the destination session's policy, the AI Additions connection,
-- the phase state or the phase design), no handler has run and the caller
-- receives 503. Such a result is stored as 'retryable': a retry with the same
-- (service_id, event_id) atomically claims it back and is processed again,
-- instead of being dropped as a duplicate. Every other status stays terminal
-- for deduplication, as before.

ALTER TABLE external_service_results
DROP CONSTRAINT IF EXISTS external_service_results_status_check;

ALTER TABLE external_service_results
ADD CONSTRAINT external_service_results_status_check
CHECK (status IN (
    'callback-received',
    'completed',
    'failed',
    'unknown-correlation',
    'retryable'
));
