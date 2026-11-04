// The columns of each CSV, in order. The SQL below selects them, plus the
// keys the report-building hook needs (#945), which are not exported.
export const SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS = Object.freeze([
    "id",
    "user_id",
    "team_id",
    "name",
    "gender",
    "question_number",
    "question_text",
    "left_pole",
    "right_pole",
    "max_scale_range",
    "selected_value",
    "comment",
    "phase_number",
    "time",
]);

export const SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS = Object.freeze([
    "id",
    "user_id",
    "external_agent_id",
    "team_id",
    "author_role",
    "name",
    "gender",
    "external_service_id",
    "question_number",
    "question_text",
    "left_pole",
    "right_pole",
    "message",
    "phase_number",
    "time",
    "reply_to",
]);

export function buildSemanticDifferentialResponsesReportSql() {
    return `
        SELECT
            ds.id,
            ds.uid AS user_id,
            (
                SELECT tu.tmid
                FROM teamusers AS tu
                INNER JOIN teams AS t
                    ON t.id = tu.tmid
                WHERE tu.uid = ds.uid
                  AND t.sesid = st.sesid
                  AND t.stageid = st.id
                ORDER BY tu.tmid
                LIMIT 1
            ) AS team_id,
            u.name,
            u.sex AS gender,
            d.orden AS question_number,
            d.title AS question_text,
            d.title_content_type AS question_text_content_type,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            d.num AS max_scale_range,
            ds.sel AS selected_value,
            ds.comment,
            st.number AS phase_number,
            ds.stime AS time,
            st.id AS phase_id,
            d.id AS question_id
        FROM differential_selection AS ds
        INNER JOIN differential AS d
            ON ds.did = d.id
        INNER JOIN stages AS st
            ON d.stageid = st.id
        INNER JOIN users AS u
            ON ds.uid = u.id
        WHERE st.sesid = $1
        ORDER BY st.number, d.orden, u.name, ds.id
    `;
}

export function buildSemanticDifferentialChatTranscriptSql() {
    return `
        SELECT
            dc.id,
            dc.uid AS user_id,
            dc.external_agent_id,
            COALESCE(dc.tmid, (
                SELECT tu.tmid
                FROM teamusers AS tu
                INNER JOIN teams AS t
                    ON t.id = tu.tmid
                WHERE tu.uid = dc.uid
                  AND t.sesid = st.sesid
                  AND t.stageid = st.id
                ORDER BY tu.tmid
                LIMIT 1
            )) AS team_id,
            CASE
                WHEN esa.id IS NOT NULL THEN 'external_service'
                ELSE u.role
            END AS author_role,
            COALESCE(esa.display_name, u.name) AS name,
            u.sex AS gender,
            esa.service_id AS external_service_id,
            d.orden AS question_number,
            d.title AS question_text,
            d.title_content_type AS question_text_content_type,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            dc.content AS message,
            st.number AS phase_number,
            dc.stime AS time,
            dc.parent_id AS reply_to,
            st.id AS phase_id,
            d.id AS question_id,
            dc.external_service_result_id
        FROM differential_chat AS dc
        INNER JOIN differential AS d
            ON dc.did = d.id
        INNER JOIN stages AS st
            ON d.stageid = st.id
        LEFT JOIN users AS u
            ON dc.uid = u.id
        LEFT JOIN external_service_agents AS esa
            ON dc.external_agent_id = esa.id
        WHERE st.sesid = $1
        ORDER BY st.number, d.orden, team_id, dc.stime, dc.id
    `;
}

// The session's phases with their questions, and its groups: what a row a
// service adds to the chat transcript may name (#945).
export function buildSemanticDifferentialSessionQuestionsSql() {
    return `
        SELECT
            st.id AS phase_id,
            st.number AS phase_number,
            d.id AS question_id,
            d.orden AS question_number,
            d.title AS question_text,
            d.title_content_type AS question_text_content_type,
            d.tleft AS left_pole,
            d.tright AS right_pole
        FROM stages AS st
        LEFT JOIN differential AS d
            ON d.stageid = st.id
        WHERE st.sesid = $1
        ORDER BY st.number, d.orden, d.id
    `;
}

export function buildSessionGroupsSql() {
    return `
        SELECT
            t.id AS team_id,
            t.stageid AS phase_id
        FROM teams AS t
        WHERE t.sesid = $1
    `;
}

// The agent row of each contributing service, which names its contributed
// chat rows.
export function buildExternalServiceAgentsSql() {
    return `
        SELECT
            esa.id AS external_agent_id,
            esa.service_id,
            esa.display_name
        FROM external_service_agents AS esa
        WHERE esa.service_id = ANY($1::text[])
    `;
}
