// Merging service contributions into the semantic-differential reports
// (epic #620, #945), with the real collector over fake services and stores.
import assert from "node:assert/strict";
import test from "node:test";

import { buildCsv } from "../csv-builder.js";
import {
    SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS,
    SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS,
} from "../report-query-builders.js";
import {
    buildReportWithContributions,
    buildSessionChatScope,
    chatTranscriptRowKeys,
    responsesRowKeys,
} from "../report-contributions.js";
import { withPlainQuestionText } from "../report-rows.js";
import { collectReportContributions } from "../../../services/external-service-report-contributions.js";

const BOM = "﻿";
const SESSION_ID = 12;

// Student text that may reach a contribution, and must never reach the audit
// or a log.
const PRIVATE_MARKER = "private student justification 945";

function responseRow(id, overrides = {}) {
    return {
        id,
        user_id:                    30 + id,
        team_id:                    4,
        name:                       `Student ${id}`,
        gender:                     "F",
        question_number:            1,
        question_text:              "**Should Ana report it?**",
        question_text_content_type: "text/markdown",
        left_pole:                  "No",
        right_pole:                 "Yes",
        max_scale_range:            7,
        selected_value:             3,
        comment:                    "A \"quoted\"\njustification",
        phase_number:               1,
        time:                       new Date("2026-10-01T10:00:00.000Z"),
        phase_id:                   71,
        question_id:                81,
        ...overrides,
    };
}

function chatRow(id, time, overrides = {}) {
    return {
        id,
        user_id:                    31,
        external_agent_id:          null,
        team_id:                    4,
        author_role:                "A",
        name:                       "Student 1",
        gender:                     "F",
        external_service_id:        null,
        question_number:            1,
        question_text:              "Should Ana report it?",
        question_text_content_type: null,
        left_pole:                  "No",
        right_pole:                 "Yes",
        message:                    `Message ${id}`,
        phase_number:               1,
        time:                       new Date(time),
        reply_to:                   null,
        phase_id:                   71,
        question_id:                81,
        external_service_result_id: null,
        ...overrides,
    };
}

const RESPONSE_ROWS = [responseRow(1), responseRow(2), responseRow(3)];

const CHAT_ROWS = [
    chatRow(501, "2026-10-01T10:00:00.000Z"),
    chatRow(502, "2026-10-01T10:02:00.000Z"),
    chatRow(503, "2026-10-01T10:01:00.000Z", { team_id: 5 }),
    chatRow(504, "2026-10-01T09:00:00.000Z", {
        phase_number: 2,
        phase_id:     72,
        question_id:  82,
        team_id:      6,
    }),
];

function questionRow(phaseId, phaseNumber, questionId, questionText, contentType, poles) {
    return {
        phase_id:                   phaseId,
        phase_number:               phaseNumber,
        question_id:                questionId,
        question_number:            1,
        question_text:              questionText,
        question_text_content_type: contentType,
        left_pole:                  poles[0],
        right_pole:                 poles[1],
    };
}

const SESSION_SCOPE = buildSessionChatScope([
    questionRow(71, 1, 81, "Should Ana report it?", null, ["No", "Yes"]),
    questionRow(72, 2, 82, "**Why?**", "text/markdown", ["Less", "More"]),
], [
    { team_id: 4, phase_id: 71 },
    { team_id: 5, phase_id: 71 },
    { team_id: 6, phase_id: 72 },
]);

const AGENTS = [{ external_agent_id: 9, service_id: "chat-service", display_name: "Chat agent" }];

const PREFIXES = {
    "review-service": "review_",
    "tutor-service":  "tutor_",
    "chat-service":   "chat_",
};

// The registry's collectReportContributions, over fake services: `handlers`
// maps service id to handler, in subscription order.
function collectorFor(handlers, { timeoutMs = 200 } = {}) {
    const services = new Map(Object.keys(handlers).map(id => [id, { id, report: { columnPrefix: PREFIXES[id] } }]));
    const resultsStore = {
        listSessionServiceIds: async () => Object.keys(handlers),
        listResults:           async () => [],
    };
    return (reportType, context, { reservedColumnIds }) => collectReportContributions({
        reportType,
        context,
        services,
        subscribers: Object.entries(handlers).map(([serviceId, handler]) => ({ serviceId, handler })),
        resultsStore,
        timeoutMs,
        reservedColumnIds,
    });
}

async function captureWarnings(fn) {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => { warnings.push(args.join(" ")); };
    try {
        return { result: await fn(), warnings };
    } finally {
        console.warn = originalWarn;
    }
}

function buildResponses(handlers, options = {}) {
    return buildReportWithContributions({
        reportType: "responses",
        sessionId:  SESSION_ID,
        designType: "semantic_differential",
        columns:    SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS,
        rows:       options.rows ?? RESPONSE_ROWS,
        collect:    options.collect ?? collectorFor(handlers, options),
    });
}

function buildChat(handlers, options = {}) {
    return buildReportWithContributions({
        reportType:        "chat_transcript",
        sessionId:         SESSION_ID,
        designType:        "semantic_differential",
        columns:           SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS,
        rows:              options.rows ?? CHAT_ROWS,
        collect:           options.collect ?? collectorFor(handlers, options),
        loadSessionScope:  options.loadSessionScope ?? (async () => SESSION_SCOPE),
        loadServiceAgents: async () => AGENTS,
    });
}

function csvOf(report) {
    return buildCsv(report.columns, report.rows);
}

// What the reports produced before #945.
function legacyCsv(columns, rows) {
    return buildCsv(columns, withPlainQuestionText(rows));
}

function parseCsvLine(line) {
    return [...line.matchAll(/"((?:[^"]|"")*)"/gu)].map(match => match[1].replaceAll("\"\"", "\""));
}

// ─── Row keys ────────────────────────────────────────────────────────────────

test("handlers receive the documented row keys of each report", () => {
    assert.deepEqual(responsesRowKeys([RESPONSE_ROWS[0]]), [
        { responseId: 1, phaseId: 71, questionId: 81, userId: 31, groupId: 4 },
    ]);
    assert.deepEqual(chatTranscriptRowKeys([chatRow(501, "2026-10-01T10:00:00.000Z", {
        external_service_id: "chat-service", external_service_result_id: "f1a2b3c4-0000-4000-8000-000000000001",
        external_agent_name: "ConversationGuide",
    })]), [{
        messageId:               501,
        phaseId:                 71,
        questionId:              81,
        groupId:                 4,
        userId:                  31,
        externalServiceId:       "chat-service",
        externalServiceResultId: "f1a2b3c4-0000-4000-8000-000000000001",
        externalAgentName:       "ConversationGuide",
        time:                    "2026-10-01T10:00:00.000Z",
    }]);
    // A participant's message has no agent row (#1155).
    assert.equal(chatTranscriptRowKeys([chatRow(502, "2026-10-01T10:01:00.000Z")])[0].externalAgentName, null);
});

// ─── No contributors ────────────────────────────────────────────────────────

test("without contributors both reports are byte-identical to the report's own CSV", async () => {
    const responses = await buildResponses({});
    const chat = await buildChat({});

    assert.equal(csvOf(responses), legacyCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, RESPONSE_ROWS));
    assert.equal(csvOf(chat), legacyCsv(SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, CHAT_ROWS));
    assert.deepEqual(responses.contributions, []);
    assert.deepEqual(chat.contributions, []);
    assert.equal(responses.collectionFailed, false);
});

test("a contribution with nothing to add leaves the CSV byte-identical", async () => {
    const responses = await buildResponses({ "review-service": async () => null });
    const chat = await buildChat({ "chat-service": async () => ({ columns: [], values: [], rows: [] }) });

    assert.equal(csvOf(responses), legacyCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, RESPONSE_ROWS));
    assert.equal(csvOf(chat), legacyCsv(SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, CHAT_ROWS));
    assert.deepEqual(responses.contributions, [
        { serviceId: "review-service", status: "completed", columns: 0, values: 0, rows: 0 },
    ]);
});

test("a failed collection still delivers the report's own CSV and is recorded", async () => {
    const { result, warnings } = await captureWarnings(() => buildResponses({}, {
        collect: async () => { throw new Error(PRIVATE_MARKER); },
    }));

    assert.equal(csvOf(result), legacyCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, RESPONSE_ROWS));
    assert.equal(result.collectionFailed, true);
    assert.deepEqual(result.contributions, []);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0], new RegExp(PRIVATE_MARKER, "u"));
});

// ─── Columns ─────────────────────────────────────────────────────────────────

test("completed contributions add their columns after the report's, in service order", async () => {
    const report = await buildResponses({
        "tutor-service": async () => ({
            columns: [{ id: "tutor_title", label: "Title" }, { id: "tutor_score" }],
            values:  [
                { rowKey: 1, values: { tutor_title: "Clear \"claim\"\nwith a newline", tutor_score: 0.5 } },
                { rowKey: "3", values: { tutor_score: 1 } },
            ],
        }),
        "review-service": async () => ({
            columns: [{ id: "review_note" }],
            values:  [{ rowKey: 2, values: { review_note: true } }],
        }),
    });

    assert.deepEqual(report.columns, [
        ...SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, "tutor_title", "tutor_score", "review_note",
    ]);

    const csv = csvOf(report);
    assert.equal(csv.codePointAt(0), 0xFEFF);
    assert.ok(csv.startsWith(`${BOM}"id","user_id",`));
    assert.ok(csv.split("\n")[0].endsWith("\"time\",\"tutor_title\",\"tutor_score\",\"review_note\""));
    // Every field quoted; quotes doubled (#611).
    assert.ok(csv.includes("\"Clear \"\"claim\"\"\nwith a newline\",\"0.5\",\"\"\n"));

    // One row per report row (#610), with an empty field where nothing was contributed.
    assert.equal(report.rows.length, RESPONSE_ROWS.length);
    assert.deepEqual(report.rows.map(row => [row.id, row.tutor_score, row.review_note]), [
        [1, 0.5, null], [2, null, true], [3, 1, null],
    ]);
    // The report's own fields are unchanged, with plain question text.
    assert.equal(report.rows[0].question_text, "Should Ana report it?");

    assert.deepEqual(report.contributions, [
        { serviceId: "tutor-service", status: "completed", columns: 2, values: 2, rows: 0 },
        { serviceId: "review-service", status: "completed", columns: 1, values: 1, rows: 0 },
    ]);
});

test("the report's own CSV prefix is unchanged by contributed columns", async () => {
    const report = await buildResponses({
        "review-service": async () => ({ columns: [{ id: "review_note" }], values: [] }),
    });
    const legacyLines = legacyCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, RESPONSE_ROWS).split("\n");
    const lines = csvOf(report).split("\n");

    assert.equal(lines.length, legacyLines.length);
    lines.forEach((line, index) => {
        if (legacyLines[index] === "") {
            assert.equal(line, "");
        } else {
            assert.ok(line.startsWith(legacyLines[index]));
        }
    });
});

test("a contributed column cannot reuse a report column", async () => {
    const saved = { ...PREFIXES };
    PREFIXES["review-service"] = "question_";
    try {
        const { result } = await captureWarnings(() => buildResponses({
            "review-service": async () => ({ columns: [{ id: "question_note" }, { id: "question_text" }] }),
        }));
        assert.deepEqual(result.columns, SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS);
        assert.deepEqual(result.contributions[0].problems, ["columns[1].id question_text is a report column"]);
    } finally {
        Object.assign(PREFIXES, saved);
    }
});

test("the responses report accepts columns only: a contribution with rows is left out", async () => {
    const { result } = await captureWarnings(() => buildResponses({
        "review-service": async () => ({
            columns: [{ id: "review_note" }],
            rows:    [{ phaseId: 71, time: "2026-10-01T10:00:00.000Z", message: "x" }],
        }),
    }));

    assert.equal(csvOf(result), legacyCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, RESPONSE_ROWS));
    assert.equal(result.contributions[0].status, "invalid");
    assert.deepEqual(result.contributions[0].problems, ["rows are not accepted by the responses report"]);
});

// ─── Unknown row keys and an empty report ───────────────────────────────────

test("values for a row the report does not have make the contribution invalid", async () => {
    const { result, warnings } = await captureWarnings(() => buildResponses({
        "review-service": async () => ({
            columns: [{ id: "review_note" }],
            values:  [
                { rowKey: 1, values: { review_note: PRIVATE_MARKER } },
                { rowKey: 999, values: { review_note: PRIVATE_MARKER } },
            ],
        }),
        "tutor-service": async () => ({
            columns: [{ id: "tutor_score" }],
            values:  [{ rowKey: 2, values: { tutor_score: 4 } }],
        }),
    }));

    assert.deepEqual(result.columns, [...SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, "tutor_score"]);
    assert.deepEqual(result.contributions, [
        {
            serviceId: "review-service",
            status:    "invalid",
            columns:   0,
            values:    0,
            rows:      0,
            reason:    "the contribution is invalid",
            problems:  ["values[1].rowKey is not a row of the report"],
        },
        { serviceId: "tutor-service", status: "completed", columns: 1, values: 1, rows: 0 },
    ]);
    assert.doesNotMatch(JSON.stringify(result.contributions), new RegExp(PRIVATE_MARKER, "u"));
    assert.doesNotMatch(warnings.join("\n"), new RegExp(PRIVATE_MARKER, "u"));
    assert.doesNotMatch(csvOf(result), new RegExp(PRIVATE_MARKER, "u"));
});

test("an empty report keeps its header, with the contributed columns", async () => {
    const report = await buildResponses({
        "review-service": async context => ({
            columns: [{ id: "review_note" }],
            values:  context.rows.map(row => ({ rowKey: row.responseId, values: { review_note: "x" } })),
        }),
    }, { rows: [] });

    assert.equal(csvOf(report),
        `${legacyCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, []).slice(0, -1)},"review_note"\n`);
    assert.equal(report.rows.length, 0);

    const emptyChat = await buildChat({}, { rows: [] });
    assert.equal(csvOf(emptyChat), legacyCsv(SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, []));
});

// ─── Outcomes left out ──────────────────────────────────────────────────────

test("a contribution that fails, times out or is invalid is left out and audited", async () => {
    const { result, warnings } = await captureWarnings(() => buildChat({
        "review-service": async () => { throw new Error(PRIVATE_MARKER); },
        "tutor-service":  () => new Promise(() => {}),
        "chat-service":   async () => ({
            columns: [{ id: "chat_note" }],
            values:  [{ rowKey: 501, values: { chat_note: { text: PRIVATE_MARKER } } }],
        }),
    }, { timeoutMs: 20 }));

    assert.equal(csvOf(result), legacyCsv(SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, CHAT_ROWS));
    assert.deepEqual(result.contributions.map(({ serviceId, status, columns, rows }) => ({
        serviceId, status, columns, rows,
    })), [
        { serviceId: "review-service", status: "failed", columns: 0, rows: 0 },
        { serviceId: "tutor-service", status: "timed_out", columns: 0, rows: 0 },
        { serviceId: "chat-service", status: "invalid", columns: 0, rows: 0 },
    ]);
    assert.equal(result.contributions[0].reason, "the handler failed");
    assert.equal(result.contributions[1].reason, "timed out after 20 ms");
    assert.equal(result.contributions[0].problems, undefined);
    assert.equal(result.contributions[2].problems.length, 1);
    assert.match(result.contributions[2].problems[0], /^values\[0\]\.values\.chat_note must be/u);

    assert.equal(warnings.length, 3);
    for (const text of [JSON.stringify(result.contributions), warnings.join("\n")]) {
        assert.doesNotMatch(text, new RegExp(PRIVATE_MARKER, "u"));
    }
});

// ─── Chat rows ──────────────────────────────────────────────────────────────

test("contributed chat rows are attributed to their service and ordered by time", async () => {
    const report = await buildChat({
        "chat-service": async () => ({
            columns: [{ id: "chat_shown" }],
            values:  [{ rowKey: 502, values: { chat_shown: true } }],
            rows:    [
                // After 502 in phase 1, question 1, group 4.
                { phaseId:    71, questionId: 81, groupId:    4, time:       "2026-10-01T10:03:00.000Z",
                    message:    "After", values:     { chat_shown: false } },
                // Between 501 and 502.
                { phaseId:    71, questionId: 81, groupId:    4, time:       "2026-10-01T10:01:00.000Z",
                    message:    "Between" },
                // Ties 504's time: after the report's own row.
                { phaseId:    72, questionId: 82, groupId:    6, time:       "2026-10-01T09:00:00.000Z",
                    message:    "Tie" },
                // Group 4 sorts before group 5 in the same question, whatever the time.
                { phaseId:    71, questionId: 81, groupId:    4, time:       "2026-10-01T11:00:00.000Z",
                    message:    "Late group 4" },
            ],
        }),
    });

    assert.deepEqual(report.rows.map(row => row.id ?? row.message), [
        501, "Between", 502, "After", "Late group 4", 503, 504, "Tie",
    ]);
    assert.equal(report.rows.length, CHAT_ROWS.length + 4);

    const between = report.rows[1];
    assert.deepEqual({
        id:                  between.id,
        user_id:             between.user_id,
        gender:              between.gender,
        reply_to:            between.reply_to,
        author_role:         between.author_role,
        external_service_id: between.external_service_id,
        external_agent_id:   between.external_agent_id,
        name:                between.name,
        team_id:             between.team_id,
        phase_number:        between.phase_number,
        question_number:     between.question_number,
        question_text:       between.question_text,
        time:                between.time,
        chat_shown:          between.chat_shown,
    }, {
        id:                  null,
        user_id:             null,
        gender:              null,
        reply_to:            null,
        author_role:         "external_service",
        external_service_id: "chat-service",
        external_agent_id:   9,
        name:                "Chat agent",
        team_id:             4,
        phase_number:        1,
        question_number:     1,
        question_text:       "Should Ana report it?",
        time:                "2026-10-01T10:01:00.000Z",
        chat_shown:          null,
    });
    // Markdown question text is plain in contributed rows too.
    assert.equal(report.rows[7].question_text, "Why?");
    assert.equal(report.rows[2].chat_shown, true);
    assert.equal(report.rows[3].chat_shown, false);

    const lines = csvOf(report).split("\n");
    assert.equal(lines.length, CHAT_ROWS.length + 4 + 2);
    const header = parseCsvLine(lines[0]);
    const fields = parseCsvLine(lines[2]);
    assert.deepEqual(header, [...SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, "chat_shown"]);
    assert.equal(fields[header.indexOf("id")], "");
    assert.equal(header.includes("rut"), false);
    assert.equal(fields[header.indexOf("time")], "2026-10-01T10:01:00.000Z");

    assert.deepEqual(report.contributions, [
        { serviceId: "chat-service", status: "completed", columns: 1, values: 1, rows: 4 },
    ]);
});

test("a service without an agent row names its contributed rows by its id", async () => {
    const report = await buildReportWithContributions({
        reportType: "chat_transcript",
        sessionId:  SESSION_ID,
        designType: "semantic_differential",
        columns:    SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS,
        rows:       [],
        collect:    collectorFor({
            "chat-service": async () => ({ rows: [{ phaseId: 71, time: "2026-10-01T10:00:00.000Z" }] }),
        }),
        loadSessionScope: async () => SESSION_SCOPE,
    });

    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].name, "chat-service");
    assert.equal(report.rows[0].external_agent_id, null);
    assert.equal(report.rows[0].question_text, null);
    assert.equal(report.rows[0].message, null);
});

test("contributed rows outside the session's phases, questions or groups are left out", async () => {
    const { result, warnings } = await captureWarnings(() => buildChat({
        "chat-service": async () => ({
            rows: [
                { phaseId: 99, time: "2026-10-01T10:00:00.000Z", message: PRIVATE_MARKER },
                { phaseId: 71, questionId: 82, time: "2026-10-01T10:00:00.000Z" },
                { phaseId: 71, questionId: 81, groupId: 6, time: "2026-10-01T10:00:00.000Z" },
            ],
        }),
        "tutor-service": async () => ({
            columns: [{ id: "tutor_note" }],
            rows:    [{ phaseId: 72, questionId: 82, groupId: 6, time: "2026-10-01T09:30:00.000Z" }],
        }),
    }));

    assert.deepEqual(result.contributions, [
        {
            serviceId: "chat-service",
            status:    "invalid",
            columns:   0,
            values:    0,
            rows:      0,
            reason:    "the contribution is invalid",
            problems:  [
                "rows[0].phaseId is not a phase of the session",
                "rows[1].questionId is not a question of its phase",
                "rows[2].groupId is not a group of its phase",
            ],
        },
        { serviceId: "tutor-service", status: "completed", columns: 1, values: 0, rows: 1 },
    ]);
    assert.equal(result.rows.length, CHAT_ROWS.length + 1);
    assert.equal(result.rows.at(-1).external_service_id, "tutor-service");
    assert.deepEqual(result.columns, [...SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, "tutor_note"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /"serviceId":"chat-service".*"status":"invalid"/u);
    assert.doesNotMatch(warnings[0], new RegExp(PRIVATE_MARKER, "u"));
});

test("when the session cannot be read, contributions with rows are left out as failed", async () => {
    const { result } = await captureWarnings(() => buildChat({
        "chat-service":  async () => ({ rows: [{ phaseId: 71, time: "2026-10-01T10:00:00.000Z" }] }),
        "tutor-service": async () => ({
            columns: [{ id: "tutor_note" }],
            values:  [{ rowKey: 501, values: { tutor_note: "ok" } }],
        }),
    }, { loadSessionScope: async () => { throw new Error("database down"); } }));

    assert.deepEqual(result.contributions.map(({ serviceId, status }) => [serviceId, status]), [
        ["chat-service", "failed"], ["tutor-service", "completed"],
    ]);
    assert.equal(result.rows.length, CHAT_ROWS.length);
    assert.equal(result.rows[0].tutor_note, "ok");
});
