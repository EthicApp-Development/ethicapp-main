import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSemanticDifferentialChatTranscriptSql,
    buildSemanticDifferentialResponsesReportSql,
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
