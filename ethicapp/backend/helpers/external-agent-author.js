// The author name of an external service's chat message (#1026, epic #1025).
//
// external_service_agents keeps one row per service, whose display_name is the
// agent's canonical name (Polyadic's `ConversationGuide`); it is the fallback.
// A service may name its agent differently in each room: Polyadic sends the
// name the room shows for the agent as each callback evaluation's
// `display_name` (the teacher's nickname, or `agente` / `agent` by the room's
// locale). That name is stored with the callback result the message links to
// (chat.external_service_result_id, V39), never in a chat column:
//
// - adapter_result.payload.publishedMessages[].displayName, which the adapter
//   writes once its callback-received handler completes;
// - until then, raw_payload.evaluations[].display_name of the evaluation whose
//   `agente` is the message's agent, stored when the callback arrived.
//
// A result whose user was anonymized has every string of its JSON redacted
// (V31), so its names are ignored and the message keeps the canonical name.
// A result completed before #1026 lists its published messages without
// `displayName`, so those messages keep the author they had.

// The longest author name kept, Polyadic's agent_nickname max_length.
export const EXTERNAL_AGENT_AUTHOR_MAX_LENGTH = 80;

/**
 * A service-supplied author name, trimmed and cut to
 * EXTERNAL_AGENT_AUTHOR_MAX_LENGTH characters, or "" when it is not a
 * non-blank string. The SQL below applies the same rule.
 */
export function normalizeExternalAgentAuthorName(value) {
    if (typeof value !== "string") {
        return "";
    }
    return Array.from(value.trim()).slice(0, EXTERNAL_AGENT_AUTHOR_MAX_LENGTH).join("").trim();
}

function jsonArray(expression) {
    return `CASE WHEN jsonb_typeof(${expression}) = 'array' THEN ${expression} ELSE '[]'::jsonb END`;
}

/**
 * A SQL expression for the per-message author name of the agent message
 * aliased `messageAlias` (a chat or differential_chat row), or NULL when its
 * callback result names none. `agentAlias` is the joined
 * external_service_agents row. Use it ahead of the canonical name:
 * `COALESCE(<expression>, esa.display_name, u.name)`.
 */
export function externalAgentAuthorNameSql(messageAlias, agentAlias = "esa") {
    const published = "author_result.adapter_result -> 'payload' -> 'publishedMessages'";
    const evaluations = "author_result.raw_payload -> 'evaluations'";
    return `
        CASE WHEN ${messageAlias}.external_service_result_id IS NOT NULL THEN (
            SELECT NULLIF(btrim(left(btrim(
                CASE
                    WHEN jsonb_typeof(${published}) = 'array' THEN (
                        SELECT published_message ->> 'displayName'
                        FROM jsonb_array_elements(${jsonArray(published)}) AS published_message
                        WHERE published_message ->> 'messageId' = ${messageAlias}.id::text
                          AND jsonb_typeof(published_message -> 'displayName') = 'string'
                        LIMIT 1
                    )
                    ELSE (
                        SELECT evaluation ->> 'display_name'
                        FROM jsonb_array_elements(${jsonArray(evaluations)}) AS evaluation
                        WHERE evaluation ->> 'agente' = ${agentAlias}.display_name
                          AND jsonb_typeof(evaluation -> 'display_name') = 'string'
                        LIMIT 1
                    )
                END
            ), ${EXTERNAL_AGENT_AUTHOR_MAX_LENGTH})), '')
            FROM external_service_results AS author_result
            LEFT JOIN users AS author_result_user
                ON author_result_user.id = author_result.user_id
            WHERE author_result.id = ${messageAlias}.external_service_result_id
              AND author_result_user.anonymized_at IS NULL
        ) END`;
}
