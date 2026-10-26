-- Room-scoped external service jobs (#833).
--
-- Design notes:
--
-- A job has a kind. 'hook' is every job so far: one dispatch of one hook,
-- completed by its outcome. 'room' is a long-lived job that an adapter opens
-- for one room (session, phase, group) when it creates the room in the AI
-- service, such as a Polyadic room at phase-started. Its id is the room's
-- correlation id, sent to the service, which uses it for the room's proactive
-- callbacks.
--
-- Room jobs use two statuses of their own:
--
--   pending -> open -> closed, or pending -> failed (the room was not created)
--
-- 'open': the room exists and the job accepts repeated callbacks, each
-- deduplicated by eventId; a callback outcome never completes it. 'closed':
-- the phase ended, the activity finished, or a newer room job of the same room
-- superseded it; a callback correlated to it is refused. Hook jobs never use
-- either status.
--
-- room_bound records whether the service acknowledged the room correlation id
-- when the room was created (Polyadic echoes it). A callback that carries no
-- job and names a room with an open bound job is refused: that room's
-- callbacks must carry its job. Unbound rooms keep the verified-destination
-- rule of #815.

ALTER TABLE external_service_jobs
ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'hook';

ALTER TABLE external_service_jobs
ADD COLUMN IF NOT EXISTS room_bound boolean NOT NULL DEFAULT false;

ALTER TABLE external_service_jobs
DROP CONSTRAINT IF EXISTS external_service_jobs_kind_check;

ALTER TABLE external_service_jobs
ADD CONSTRAINT external_service_jobs_kind_check
CHECK (kind IN ('hook', 'room'));

ALTER TABLE external_service_jobs
DROP CONSTRAINT IF EXISTS external_service_jobs_room_bound_check;

ALTER TABLE external_service_jobs
ADD CONSTRAINT external_service_jobs_room_bound_check
CHECK (kind = 'room' OR room_bound = false);

ALTER TABLE external_service_jobs
DROP CONSTRAINT IF EXISTS external_service_jobs_status_check;

ALTER TABLE external_service_jobs
ADD CONSTRAINT external_service_jobs_status_check
CHECK (status IN (
    'pending',
    'dispatched',
    'callback-received',
    'completed',
    'failed',
    'skipped',
    'expired',
    'open',
    'closed'
));

-- The live room jobs of a room: supersession, closing a phase, and the bound
-- check for callbacks without a job.
CREATE INDEX IF NOT EXISTS idx_external_service_jobs_live_rooms
ON external_service_jobs (service_id, session_id, phase_id, group_id)
WHERE kind = 'room' AND status IN ('pending', 'open');
