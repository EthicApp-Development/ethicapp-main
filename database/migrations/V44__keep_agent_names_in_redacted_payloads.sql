-- Keep the agent names of AI service payloads when a student is forgotten
-- (#1155, follow-up of epic #1025).
--
-- Design notes:
--
-- Forgetting a student (V31, #876) replaces every non-empty string of the
-- AI service payloads tied to the student (the callback results'
-- raw_payload, sanitized_payload and adapter_result, and the jobs'
-- outbound_payload) with the run's placeholder. A Polyadic reactive callback
-- answers a job created for the student's chat message, so its result takes
-- the student's user_id, and its agent names became the placeholder too.
-- The activity report's "Polyadic agent" column, which reads them, then
-- showed `******` for the agent of those replies.
--
-- An agent name is not the student's data: it is an identifier the service
-- chooses, such as Polyadic's `ConversationGuide` or `Validator`. The two
-- keys that hold one are kept:
--
-- - `agente`: each Polyadic callback evaluation's agent
--   (`raw_payload.evaluations[].agente`);
-- - `agentName`: each message the Polyadic bridge published
--   (`adapter_result.payload.publishedMessages[].agentName`).
--
-- Only a string value is kept, and only under one of those keys; every other
-- string, at any depth, is still replaced, including the agents' replies
-- (`respuesta`) and the per-room guide name (`display_name`), which a
-- teacher may have written. A key enters this list only when no service
-- ever puts user text under it. The management console's redactJsonStrings
-- applies the same rule (management-console/backend/helpers/
-- student-ai-service-data-helper.js); keep both lists equal.
--
-- Payloads already redacted keep the placeholder: the names they lost cannot
-- be recovered. For published messages the report falls back to the message
-- row's agent (external_agent_id), which the erasure never touches.
--
-- The function keeps its signature, so the V31 triggers and their callers
-- use the new rule without change.

CREATE OR REPLACE FUNCTION redact_jsonb_strings(value jsonb, placeholder text)
RETURNS jsonb AS $$
BEGIN
    CASE jsonb_typeof(value)
        WHEN 'string' THEN
            IF value = '""'::jsonb THEN
                RETURN value;
            END IF;
            RETURN to_jsonb(placeholder);
        WHEN 'array' THEN
            RETURN COALESCE(
                (
                    SELECT jsonb_agg(redact_jsonb_strings(item, placeholder) ORDER BY position)
                    FROM jsonb_array_elements(value) WITH ORDINALITY AS items (item, position)
                ),
                '[]'::jsonb
            );
        WHEN 'object' THEN
            RETURN COALESCE(
                (
                    SELECT jsonb_object_agg(
                        key,
                        CASE
                            WHEN key IN ('agente', 'agentName') AND jsonb_typeof(item) = 'string'
                                THEN item
                            ELSE redact_jsonb_strings(item, placeholder)
                        END
                    )
                    FROM jsonb_each(value) AS entries (key, item)
                ),
                '{}'::jsonb
            );
        ELSE
            RETURN value;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
