-- End time of each activity (epic #1046, sub-issue #1047).
--
-- Design notes:
--
-- The activities list shows when a finished activity ended. Finishing an
-- activity runs FINISH_SESSION_SQL (ethicapp/backend/helpers/
-- activity-finish-helper.js), for the teacher's own finish and for the
-- internal finish of a forgotten teacher's open activities (#877). When a
-- session that was not finished becomes finished, that same update sets
-- finished_at to now(). A repeated or resumed finish keeps the first time.
-- Nothing else writes the column: launching, restoring or archiving an
-- activity leaves it as it is.
--
-- Sessions finished before this migration stay null, also when the teacher
-- finishes one again; they are not backfilled. Their end time is unknown,
-- and guessing it from their responses would record a time nobody saw.
--
-- No data changes.

ALTER TABLE sessions
ADD COLUMN finished_at timestamptz NULL;
