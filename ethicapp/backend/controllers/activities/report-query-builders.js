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
            u.rut,
            u.sex AS gender,
            d.orden AS question_number,
            d.title AS question_text,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            d.num AS max_scale_range,
            ds.sel AS selected_value,
            ds.comment,
            st.number AS phase_number,
            ds.stime AS time
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
            u.name,
            u.rut,
            u.sex AS gender,
            d.orden AS question_number,
            d.title AS question_text,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            dc.content AS message,
            st.number AS phase_number,
            dc.stime AS time,
            dc.parent_id AS reply_to
        FROM differential_chat AS dc
        INNER JOIN differential AS d
            ON dc.did = d.id
        INNER JOIN stages AS st
            ON d.stageid = st.id
        INNER JOIN users AS u
            ON dc.uid = u.id
        WHERE st.sesid = $1
        ORDER BY st.number, d.orden, team_id, dc.stime, dc.id
    `;
}
