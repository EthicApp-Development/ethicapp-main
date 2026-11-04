import assert from "node:assert/strict";
import test from "node:test";

import {
    SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS,
    SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS,
    buildExternalServiceAgentsSql,
    buildSemanticDifferentialChatTranscriptSql,
    buildSemanticDifferentialResponsesReportSql,
    buildSemanticDifferentialSessionQuestionsSql,
    buildSessionGroupsSql,
} from "../report-query-builders.js";
import { withPlainQuestionText } from "../report-rows.js";
import { buildCsv } from "../csv-builder.js";

test("responses report resolves at most one team for each source row", () => {
    const sql = buildSemanticDifferentialResponsesReportSql();

    assert.doesNotMatch(sql, /LEFT JOIN teams AS t/);
    assert.match(sql, /SELECT tu\.tmid[\s\S]*tu\.uid = ds\.uid/);
    assert.match(sql, /t\.sesid = st\.sesid[\s\S]*t\.stageid = st\.id/);
    assert.match(sql, /ORDER BY tu\.tmid[\s\S]*LIMIT 1[\s\S]*\) AS team_id/);
});

test("chat transcript preserves its recorded team and avoids phase-wide team joins", () => {
    const sql = buildSemanticDifferentialChatTranscriptSql();

    assert.doesNotMatch(sql, /LEFT JOIN teams AS t/);
    assert.doesNotMatch(sql, /INNER JOIN users AS u/);
    assert.match(sql, /COALESCE\(dc\.tmid, \([\s\S]*tu\.uid = dc\.uid/);
    assert.match(sql, /t\.sesid = st\.sesid[\s\S]*t\.stageid = st\.id/);
    assert.match(sql, /ORDER BY tu\.tmid[\s\S]*LIMIT 1[\s\S]*\)\) AS team_id/);
    assert.match(sql, /LEFT JOIN users AS u[\s\S]*ON dc\.uid = u\.id/);
    assert.match(sql, /LEFT JOIN external_service_agents AS esa[\s\S]*ON dc\.external_agent_id = esa\.id/);
    assert.match(sql, /dc\.external_agent_id/);
    assert.match(sql, /WHEN esa\.id IS NOT NULL THEN 'external_service'/);
    assert.match(sql, /COALESCE\(esa\.display_name, u\.name\) AS name/);
    assert.match(sql, /esa\.service_id AS external_service_id/);
});

// ─── No RUT in the exports (#1071) ──────────────────────────────────────────

// The headers before #1071, minus `rut`: every other column keeps its order.
const RESPONSE_HEADER = [
    "id", "user_id", "team_id", "name", "gender", "question_number", "question_text",
    "left_pole", "right_pole", "max_scale_range", "selected_value", "comment",
    "phase_number", "time",
];
const CHAT_HEADER = [
    "id", "user_id", "external_agent_id", "team_id", "author_role", "name", "gender",
    "external_service_id", "question_number", "question_text", "left_pole", "right_pole",
    "message", "phase_number", "time", "reply_to",
];

test("the responses and chat exports have no rut column, and keep the other columns' order", () => {
    assert.deepEqual([...SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS], RESPONSE_HEADER);
    assert.deepEqual([...SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS], CHAT_HEADER);
    const headers = [...RESPONSE_HEADER, ...CHAT_HEADER];
    assert.deepEqual(headers.filter(column => /rut/i.test(column)), []);
});

test("neither report reads the user's rut", () => {
    for (const sql of [buildSemanticDifferentialResponsesReportSql(),
        buildSemanticDifferentialChatTranscriptSql()]) {
        assert.doesNotMatch(sql, /\brut\b/i);
    }
});

// ─── Plain question text (#768) ─────────────────────────────────────────────

const BOM = "\uFEFF";

test("both reports select the question's content type", () => {
    for (const sql of [buildSemanticDifferentialResponsesReportSql(),
        buildSemanticDifferentialChatTranscriptSql()]) {
        assert.match(sql,
            /d\.title AS question_text,\s+d\.title_content_type AS question_text_content_type/);
    }
});

test("Markdown question text is exported as plain text, and the column list is unchanged", () => {
    const markdown = "text/markdown";
    const rows = withPlainQuestionText([
        {
            id:                         1,
            question_text:              "**¿Qué harías?**\\\nPiensa en *Sebastián*.",
            question_text_content_type: markdown,
        },
        { id: 2, question_text: "1. uno\n2. dos", question_text_content_type: markdown },
    ]);
    const plain = ["¿Qué harías?\nPiensa en Sebastián.", "1. uno\n2. dos"];

    assert.deepEqual(rows.map(row => row.question_text), plain);
    assert.equal(buildCsv(["id", "question_text"], rows),
        `${BOM}"id","question_text"\n"1","${plain[0]}"\n"2","${plain[1]}"\n`);
});

test("questions without a Markdown content type export byte for byte as before", () => {
    const legacy = [
        { id: 1, question_text: "  **literal**  ", question_text_content_type: null },
        { id: 2, question_text: "Línea uno\nLínea dos", question_text_content_type: "text/plain" },
        { id: 3, question_text: null, question_text_content_type: "text/markdown" },
    ];
    const columns = ["id", "question_text"];

    assert.equal(buildCsv(columns, withPlainQuestionText(legacy)), buildCsv(columns, legacy));
});

// ─── Row keys for report-building (#945) ────────────────────────────────────

test("both reports select the row keys the report-building hook needs", () => {
    assert.match(buildSemanticDifferentialResponsesReportSql(),
        /st\.id AS phase_id,\s+d\.id AS question_id\s+FROM differential_selection/);
    assert.match(buildSemanticDifferentialChatTranscriptSql(),
        /st\.id AS phase_id,\s+d\.id AS question_id,\s+dc\.external_service_result_id\s+FROM/);
});

test("the row keys add no CSV column", () => {
    const keys = ["phase_id", "question_id", "external_service_result_id"];
    for (const columns of [SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS]) {
        assert.deepEqual(keys.filter(key => columns.includes(key)), []);
    }
});

test("contributed chat rows are checked against the session's phases, questions and groups", () => {
    assert.match(buildSemanticDifferentialSessionQuestionsSql(),
        /FROM stages AS st\s+LEFT JOIN differential AS d\s+ON d\.stageid = st\.id\s+WHERE st\.sesid = \$1/);
    assert.match(buildSessionGroupsSql(), /FROM teams AS t\s+WHERE t\.sesid = \$1/);
    assert.match(buildExternalServiceAgentsSql(), /WHERE esa\.service_id = ANY\(\$1::text\[\]\)/);
});
