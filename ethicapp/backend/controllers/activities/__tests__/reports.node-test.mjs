import assert from "node:assert/strict";
import test from "node:test";

import {
    buildSemanticDifferentialChatTranscriptSql,
    buildSemanticDifferentialResponsesReportSql,
} from "../report-query-builders.js";

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
