-- Pending callback results (#815).
--
-- Every inbound callback is recorded in external_service_results as
-- 'pending': received, not yet consumed. EthicApp then decides, without
-- writing, where the callback may publish, and consumes the result with one
-- atomic UPDATE right before any handler runs (to 'callback-received' or
-- 'unknown-correlation', as before). A refusal marks it 'failed'.
--
-- While a result is pending, a retry with the same (service_id, event_id) is
-- authorized again instead of being dropped as a duplicate. So a transient
-- failure, even one that also prevents any write, never consumes the event.
-- Only one attempt can consume it. Every other status stays terminal for
-- deduplication, as before.

ALTER TABLE external_service_results
DROP CONSTRAINT IF EXISTS external_service_results_status_check;

ALTER TABLE external_service_results
ADD CONSTRAINT external_service_results_status_check
CHECK (status IN (
    'callback-received',
    'completed',
    'failed',
    'unknown-correlation',
    'pending'
));
