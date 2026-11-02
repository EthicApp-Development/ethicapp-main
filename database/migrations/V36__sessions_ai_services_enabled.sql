-- The AI services switch of an activity (epic #965, sub-issue #970).
--
-- Design notes:
--
-- A teacher may launch an activity with its design's AI services turned off.
-- The switch applies to the whole activity and the design does not change.
-- The launch stores it here (ethicapp/backend/helpers/activity-launch-helper.js),
-- only while the session has no activity yet, like the AI service policy pin.
-- With the column false, the services a session's phases enable are read as
-- none (ethicapp/backend/helpers/designs-helper.js), so no hook is dispatched
-- to a service and no external_service_jobs row is created; phase-ended and
-- activity-finished still close the session's room jobs.
--
-- Existing and new sessions default to true, so they keep their services and
-- no backfill is needed.

ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS ai_services_enabled boolean NOT NULL DEFAULT true;
