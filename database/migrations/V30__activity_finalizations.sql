-- Finishing an activity that did not complete (epic #879, sub-issue #881).
--
-- Design notes:
--
-- Finishing an activity marks the session finished and clears its current
-- phase, then drops the cached student descriptor, sends phase-ended for the
-- phase it was on, tells the students and sends activity-finished. Those
-- steps run after the update, so a failure in one of them used to leave a
-- session that looked finished, had lost the phase to end, and was never
-- revisited: a retry found nothing open.
--
-- activity_finalizations holds one row per finishing that has not completed.
-- The statement that finishes the session also inserts the row, with the
-- phase the session was on, and the row is deleted once every step is done.
-- A row left by a failure makes the next finish of the session, by its
-- teacher or by the internal endpoint that finishes a teacher's activities,
-- resume the steps for that phase. A step may therefore run twice, never
-- zero times.
--
-- The phase is kept with ON DELETE SET NULL, and the row goes with its
-- session.

CREATE TABLE IF NOT EXISTS activity_finalizations (
    session_id integer PRIMARY KEY
    REFERENCES sessions (id) ON DELETE CASCADE,
    ended_phase_id integer
    REFERENCES stages (id) ON DELETE SET NULL,
    requested_at timestamptz NOT NULL DEFAULT now()
);
