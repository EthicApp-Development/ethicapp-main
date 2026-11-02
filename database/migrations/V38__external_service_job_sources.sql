-- The response or chat message each hook job processed (epic #620,
-- sub-issue #946).
--
-- Design notes:
--
-- A hook job was keyed only by session, phase, question, group and user, so
-- one user and question could have several argumentation tutor results with
-- nothing saying which response each one reviewed, and a Polyadic callback
-- correlated with a chat-message-received job could not name the student
-- message it answered. The registry now writes the record a hook dispatch
-- processed on the job it creates (services/external-services.service.js,
-- _dispatchOneHandler):
--
--   'response':     student-response-submitted; source_id is the
--                   differential_selection row written, or the actor_selection
--                   row for ranking.
--   'chat_message': chat-message-received; source_id is the saved message,
--                   in differential_chat, or in chat for ranking.
--
-- The activity's design type says which table a source_id belongs to, so
-- there is no foreign key: the reference is polymorphic, and a job keeps its
-- record after the response or message it points to is removed. Both columns
-- are null, or both are set. The second branch of the check names
-- source_kind IS NOT NULL: without it, a null kind with an id would make the
-- IN test unknown, and a check accepts unknown.
--
-- Jobs of other hooks, room jobs and every existing job keep both columns
-- null; there is no backfill.

ALTER TABLE external_service_jobs
ADD COLUMN IF NOT EXISTS source_kind text NULL;

ALTER TABLE external_service_jobs
ADD COLUMN IF NOT EXISTS source_id bigint NULL;

ALTER TABLE external_service_jobs
DROP CONSTRAINT IF EXISTS external_service_jobs_source_check;

ALTER TABLE external_service_jobs
ADD CONSTRAINT external_service_jobs_source_check
CHECK (
    (source_kind IS NULL AND source_id IS NULL)
    OR (
        source_kind IS NOT NULL
        AND source_kind IN ('response', 'chat_message')
        AND source_id IS NOT NULL
    )
);

-- The jobs, and through them the results, of one response or chat message.
CREATE INDEX IF NOT EXISTS idx_external_service_jobs_source
ON external_service_jobs (source_kind, source_id)
WHERE source_kind IS NOT NULL;
