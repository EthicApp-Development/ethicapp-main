-- Phase clock of an activity (epic #1105, sub-issue #1106).
--
-- Design notes:
--
-- A design can give each phase a duration in whole minutes. When launching,
-- the teacher chooses how the time is enforced, stored in sessions.time_mode:
--
-- - 'none': no clock, as before this migration;
-- - 'soft': the teacher moves on by hand, and the count goes on after the
--   deadline;
-- - 'hard': the activity moves to the next phase by itself at the deadline.
--
-- Activities launched before this migration get 'none' from the default.
--
-- Each phase (stages row) records its clock when it starts:
--
-- - started_at: the database's now() when the phase starts;
-- - duration_seconds: the phase's duration, copied from the design when the
--   phase starts, so a later edit of the design does not change it;
-- - ends_at: the deadline, which "+1 min" moves later;
-- - start_trigger: 'teacher' when the teacher started the phase, 'deadline'
--   when the deadline runner advanced to it, so the response policy can tell
--   an automatic advance from a manual one;
-- - deadline_handled_at: set once the deadline runner has handled ends_at,
--   so it never handles the same deadline twice.
--
-- A phase without a duration, or of an activity without a time mode, keeps
-- duration_seconds and ends_at null. Existing phases keep null in every new
-- column.
--
-- The deadline runner looks for deadlines that are set and not yet handled;
-- the partial index holds only those rows, so it stays small.
--
-- No data changes.

ALTER TABLE sessions
ADD COLUMN time_mode text NOT NULL DEFAULT 'none',
ADD CONSTRAINT sessions_time_mode_check
CHECK (time_mode IN ('none', 'soft', 'hard'));

ALTER TABLE stages
ADD COLUMN started_at timestamptz NULL,
ADD COLUMN duration_seconds integer NULL,
ADD COLUMN ends_at timestamptz NULL,
ADD COLUMN start_trigger text NULL,
ADD COLUMN deadline_handled_at timestamptz NULL,
ADD CONSTRAINT stages_duration_seconds_check
CHECK (duration_seconds > 0),
ADD CONSTRAINT stages_start_trigger_check
CHECK (start_trigger IN ('teacher', 'deadline'));

CREATE INDEX idx_stages_pending_deadline
ON stages (ends_at)
WHERE ends_at IS NOT NULL AND deadline_handled_at IS NULL;
