-- Receiver-side eventId idempotency for external-service callbacks.
--
-- Adds event_id (uuid, nullable) to external_service_results so that
-- duplicate detection is keyed on (service_id, event_id) rather than on
-- job terminal state. A partial unique index enforces DB-level uniqueness
-- for non-NULL event_id values, making ON CONFLICT DO NOTHING the safe
-- insert path. Rows without event_id remain unconstrained (backward-
-- compatible with callers that omit the field).

ALTER TABLE external_service_results
    ADD COLUMN IF NOT EXISTS event_id uuid NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_external_service_results_service_event
    ON external_service_results(service_id, event_id)
    WHERE event_id IS NOT NULL;
