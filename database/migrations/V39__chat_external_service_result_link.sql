-- The callback result an agent chat message came from (epic #620,
-- sub-issue #947).
--
-- Design notes:
--
-- An external service publishes a chat message as a row of chat (ranking)
-- or differential_chat (semantic differential) with uid NULL and
-- external_agent_id set (V14). external_service_results (V15) keeps each
-- callback the service sent, with its raw payload. When a message is
-- published while a callback is handled, external_service_result_id stores
-- the id of that callback's result, so the activity reports can tell from
-- the result what only it knows: which agent wrote the message (the shared
-- external_service_agents row keeps only the latest name) and which job the
-- callback answered.
--
-- The column is NULL for students' and teachers' messages, for agent
-- messages published outside a callback (the development mock chat agent
-- answers from chat-message-received), and for every row written before
-- this migration. Existing rows are not backfilled.
--
-- ON DELETE SET NULL: a message stays in the chat when its result row is
-- deleted, and only loses the link. Nothing deletes result rows today; the
-- forget-user flows (V31, V32) anonymize results and chat rows in place.
-- Deleting a session does not reach these rows through this key: neither
-- external_service_results.session_id nor differential_chat has a foreign
-- key to sessions with a cascade, and chat.sesid has no ON DELETE clause.
--
-- The indexes serve the reports' lookup of a session's linked messages and
-- the foreign key check when a result row is deleted. They are partial:
-- most chat rows are written by students and have no link.

ALTER TABLE chat
ADD COLUMN IF NOT EXISTS external_service_result_id uuid
REFERENCES external_service_results (id) ON DELETE SET NULL;

ALTER TABLE differential_chat
ADD COLUMN IF NOT EXISTS external_service_result_id uuid
REFERENCES external_service_results (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_external_service_result_id
ON chat (external_service_result_id)
WHERE external_service_result_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_differential_chat_external_service_result_id
ON differential_chat (external_service_result_id)
WHERE external_service_result_id IS NOT NULL;
