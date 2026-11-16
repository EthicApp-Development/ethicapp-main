// The Polyadic bridge's chat transcript rows as the export writes them: the
// bridge's contribution through the real collector and generator, with the
// SQL rows of the report faked. Who wrote each contributed row (#1228) and
// what made each agent message (#1226), epic ethicapp-ai-additions#293.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AGENT_TRIGGER, contributeToReport } from "../polyadic-bridge.adapter.js";
import { buildCsv } from "../../../controllers/activities/csv-builder.js";
import { SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS } from "../../../controllers/activities/report-query-builders.js";
import {
    buildReportWithContributions,
    buildSessionChatScope,
} from "../../../controllers/activities/report-contributions.js";
import { collectReportContributions } from "../../../services/external-service-report-contributions.js";

const SERVICE_ID = "polyadic-devils-advocate";
const SESSION_ID = 11;
const ROOM = "ethicapp-s11-p22-g301";
const ROOM_JOB_ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const AGENT_ROW = Object.freeze({ external_agent_id: 9, service_id: SERVICE_ID, display_name: "ConversationGuide" });

const EXAMPLES_URL = new URL(
    "../../../../../canonical-schemas/ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);

function example(name) {
    return JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
}

const SCOPE = buildSessionChatScope([{
    phase_id:                   22,
    phase_number:               1,
    question_id:                701,
    question_number:            1,
    question_text:              "Should Ana report it?",
    question_text_content_type: null,
    left_pole:                  "No",
    right_pole:                 "Yes",
}], [{ team_id: 301, phase_id: 22 }]);

// A transcript row as the report's SQL selects it.
function sqlRow(id, time, overrides = {}) {
    return {
        id,
        user_id:                    31,
        external_agent_id:          null,
        team_id:                    301,
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
        phase_id:                   22,
        question_id:                701,
        external_service_result_id: null,
        external_agent_name:        null,
        ...overrides,
    };
}

// A guide message the bridge published, shown under the room's name for it.
function guideSqlRow(id, resultId, time, message) {
    return sqlRow(id, time, {
        user_id:                    null,
        external_agent_id:          AGENT_ROW.external_agent_id,
        author_role:                "external_service",
        name:                       "agente",
        gender:                     null,
        external_service_id:        SERVICE_ID,
        message,
        external_service_result_id: resultId,
        external_agent_name:        AGENT_ROW.display_name,
    });
}

// A stored result of a callback the handler completed.
function callbackResult({ id, evaluations, publishedMessages, source = null, receivedAt }) {
    return {
        id,
        jobId:         source ? id + 1000 : ROOM_JOB_ID,
        hookName:      source ? "chat-message-received" : "phase-started",
        status:        "completed",
        phaseId:       22,
        questionId:    701,
        groupId:       301,
        userId:        null,
        source,
        rawPayload:    { room: ROOM, evaluations },
        adapterResult: {
            serviceId: SERVICE_ID,
            hook:      "callback-received",
            status:    "completed",
            payload:   {
                room:                ROOM,
                evaluationsReceived: evaluations.length,
                messagesPublished:   publishedMessages.length,
                publishedMessages,
            },
        },
        receivedAt,
    };
}

const ROOM_JOB = Object.freeze({
    id:                  ROOM_JOB_ID,
    kind:                "room",
    createdAt:           "2026-11-18T17:00:00.000Z",
    instantiationReport: {
        warnings:              [],
        degraded:              false,
        configurationRejected: false,
        caseInputs:            [{
            key:            "discussion_topics",
            caseId:         51,
            serviceId:      "case-analyst-topic-listing",
            documentSchema: "topic-listing/v1",
            pointer:        "/topics",
            jobId:          "9b0c7a10-1111-4222-8333-444455556666",
            generatedAt:    "2026-11-14T09:30:00.000Z",
            reviewedAt:     null,
            ids:            ["T2"],
        }],
    },
});

const LISTING_ROW = Object.freeze({
    job_id:       "9b0c7a10-1111-4222-8333-444455556666",
    generated_at: new Date("2026-11-14T09:30:00.000Z"),
    reviewed_at:  null,
    document:     { schemaVersion: "topic-listing/v1", topics: [{ id: "T2", topic: "Presión jerárquica" }] },
});

function storedDecision(name, overrides = {}) {
    const record = example(name);
    return {
        id:                        name,
        decisionId:                record.decisionId,
        phaseId:                   22,
        questionId:                701,
        groupId:                   301,
        resultId:                  null,
        record,
        windowChatMessageIds:      record.window.messages.map(() => null),
        interventionChatMessageId: null,
        decidedAt:                 new Date(record.decidedAt).toISOString(),
        receivedAt:                null,
        job:                       ROOM_JOB,
        ...overrides,
    };
}

// The chat transcript of session 11 with the bridge's contribution, as the
// export builds it.
async function exportTranscript({ rows, results, decisions = [] }) {
    const reader = { list: async () => results, mediationDecisions: async () => decisions };
    const report = await buildReportWithContributions({
        reportType: "chat_transcript",
        sessionId:  SESSION_ID,
        designType: "semantic_differential",
        columns:    SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS,
        rows,
        collect:    (reportType, context, { reservedColumnIds }) => collectReportContributions({
            reportType,
            context,
            services:     new Map([[SERVICE_ID, { id: SERVICE_ID, report: { columnPrefix: "polyadic_" } }]]),
            subscribers:  [{
                serviceId: SERVICE_ID,
                handler:   handlerContext => contributeToReport(handlerContext, { results: reader }, {
                    getCaseAnalysis: async () => LISTING_ROW,
                }),
            }],
            resultsStore: { listSessionServiceIds: async () => [SERVICE_ID], listResults: async () => [] },
            reservedColumnIds,
        }),
        loadSessionScope:  async () => SCOPE,
        loadServiceAgents: async () => [AGENT_ROW],
    });
    assert.deepEqual(report.contributions.map(({ status }) => status), ["completed"],
        JSON.stringify(report.contributions));
    return { ...report, csv: buildCsv(report.columns, report.rows) };
}

function parseCsvLine(line) {
    return [...line.matchAll(/"((?:[^"]|"")*)"/gu)].map(match => match[1].replaceAll("\"\"", "\""));
}

function authorOf(row) {
    return { name: row.name, external_agent_id: row.external_agent_id };
}

// A contentCoverage room: a published guide message, an unpublished
// Validator evaluation, two decisions and the room's topic list.
function coverageSession() {
    return {
        rows: [
            sqlRow(5000, "2026-11-18T17:04:00.000Z"),
            guideSqlRow(6001, 92, "2026-11-18T17:05:13.000Z", "¿Y la supervisora?"),
        ],
        results: [callbackResult({
            id:          92,
            receivedAt:  "2026-11-18T17:05:12.500Z",
            evaluations: [
                { agente: "Validator", respuesta: "@ConversationGuide: CONSTRUCTIVE - T2 - ..." },
                { agente: "ConversationGuide", respuesta: "¿Y la supervisora?", display_name: "agente" },
            ],
            publishedMessages: [
                { messageId: 6001, agentName: "ConversationGuide", displayName: "agente", evaluationIndex: 1 },
            ],
        })],
        decisions: [
            storedDecision("constructive.es_CL.json", { interventionChatMessageId: 6001 }),
            storedDecision("no-intervention.es_CL.json"),
        ],
    };
}

test("decision rows name their deciding agent", async () => {
    const report = await exportTranscript(coverageSession());

    const decisionRows = report.rows.filter(row => row.polyadic_row_kind === "decision");
    assert.equal(decisionRows.length, 2);
    for (const row of decisionRows) {
        assert.deepEqual(authorOf(row), { name: "Validator", external_agent_id: 9 });
        assert.equal(row.polyadic_agent_name, "Validator");
        assert.equal(row.author_role, "external_service");
    }
});

test("the room's topic list is a row no agent wrote", async () => {
    const report = await exportTranscript(coverageSession());

    const [topics] = report.rows.filter(row => row.polyadic_row_kind === "room_topics");
    assert.deepEqual(authorOf(topics), { name: null, external_agent_id: null });
    assert.equal(topics.author_role, "external_service");
    assert.equal(topics.external_service_id, SERVICE_ID);

    // Both export as empty fields.
    const [header, ...lines] = report.csv.replace(/^﻿/u, "").trimEnd().split("\n").map(parseCsvLine);
    const fields = lines[report.rows.indexOf(topics)];
    assert.equal(fields[header.indexOf("name")], "");
    assert.equal(fields[header.indexOf("external_agent_id")], "");
});

test("an unpublished Validator evaluation's row names the Validator", async () => {
    const report = await exportTranscript(coverageSession());

    const [validator] = report.rows.filter(row => row.polyadic_agent_visible_to_students === false
        && row.polyadic_row_kind === null);
    assert.equal(validator.message, "@ConversationGuide: CONSTRUCTIVE - T2 - ...");
    assert.deepEqual(authorOf(validator), { name: "Validator", external_agent_id: 9 });
});

test("an unpublished guide evaluation's row shows the room's name for the guide", async () => {
    const report = await exportTranscript({
        rows:    [],
        results: [callbackResult({
            id:          93,
            receivedAt:  "2026-11-18T17:06:00.000Z",
            evaluations: [
                { agente: "ConversationGuide", respuesta: "Lost.", display_name: "  Sofía  " },
                { agente: "ConversationGuide", respuesta: "Also lost." },
                { agente: "Orientador", respuesta: "Lost too.", display_name: "   " },
            ],
            publishedMessages: [],
        })],
    });

    assert.deepEqual(report.rows.map(row => [row.message, row.name, row.external_agent_id]), [
        ["Lost.", "Sofía", 9],
        ["Also lost.", "ConversationGuide", 9],
        ["Lost too.", "Orientador", 9],
    ]);
});

test("published message rows keep the author the report's SQL gives them", async () => {
    const session = coverageSession();
    const report = await exportTranscript(session);

    const published = report.rows.find(row => row.id === 6001);
    const { phase_id: _phaseId, question_id: _questionId, external_service_result_id: _resultId,
        external_agent_name: _agentName, question_text_content_type: _contentType, ...exported } = session.rows[1];
    for (const [column, value] of Object.entries(exported)) {
        assert.deepEqual(published[column], value, column);
    }
    assert.deepEqual(authorOf(published), { name: "agente", external_agent_id: 9 });
});

// ─── What made each agent message (#1226) ───────────────────────────────────

test("callbacks without trigger export exactly as before #1226", async () => {
    const report = await exportTranscript({
        rows: [
            guideSqlRow(600, 89, "2026-11-02T09:58:00.000Z", "Welcome."),
            sqlRow(501, "2026-11-02T09:59:00.000Z"),
            guideSqlRow(601, 90, "2026-11-02T10:00:01.000Z", "Why?"),
            guideSqlRow(602, 91, "2026-11-02T10:05:01.000Z", "Five minutes left."),
        ],
        results: [
            callbackResult({
                id:                89,
                receivedAt:        "2026-11-02T09:58:00.000Z",
                evaluations:       [{ agente: "ConversationGuide", respuesta: "Welcome.", display_name: "agente" }],
                publishedMessages: [
                    { messageId: 600, agentName: "ConversationGuide", displayName: "agente", evaluationIndex: 0 },
                ],
            }),
            callbackResult({
                id:          90,
                receivedAt:  "2026-11-02T10:00:00.500Z",
                source:      { kind: "chat_message", id: 501 },
                evaluations: [
                    { agente: "ConversationGuide", respuesta: "Why?", display_name: "agente" },
                    { agente: "ConversationGuide", respuesta: "Lost \"reply\"." },
                ],
                publishedMessages: [
                    { messageId: 601, agentName: "ConversationGuide", displayName: "agente", evaluationIndex: 0 },
                ],
            }),
            callbackResult({
                id:          91,
                receivedAt:  "2026-11-02T10:05:00.000Z",
                evaluations: [
                    { agente: "ConversationGuide", respuesta: "Five minutes left.", display_name: "agente" },
                ],
                publishedMessages: [
                    { messageId: 602, agentName: "ConversationGuide", displayName: "agente", evaluationIndex: 0 },
                ],
            }),
        ],
    });

    // Built before #1226 (and #1228) from the same callbacks.
    const common = "\"external_service\",\"%NAME%\",\"\",\"polyadic-devils-advocate\",\"1\","
        + "\"Should Ana report it?\",\"No\",\"Yes\",";
    const agent = name => common.replace("%NAME%", name);
    assert.equal(report.csv, `﻿${[
        "\"id\",\"user_id\",\"external_agent_id\",\"team_id\",\"author_role\",\"name\",\"gender\","
            + "\"external_service_id\",\"question_number\",\"question_text\",\"left_pole\",\"right_pole\","
            + "\"message\",\"phase_number\",\"time\",\"reply_to\",\"polyadic_agent_name\","
            + "\"polyadic_agent_trigger\",\"polyadic_agent_in_reply_to\",\"polyadic_agent_visible_to_students\"",
        `"600","","9","301",${agent("agente")}"Welcome.","1","2026-11-02T09:58:00.000Z","",`
            + "\"ConversationGuide\",\"unknown\",\"\",\"true\"",
        "\"501\",\"31\",\"\",\"301\",\"A\",\"Student 1\",\"F\",\"\",\"1\",\"Should Ana report it?\",\"No\",\"Yes\","
            + "\"Message 501\",\"1\",\"2026-11-02T09:59:00.000Z\",\"\",\"\",\"\",\"\",\"\"",
        `"","","9","301",${agent("ConversationGuide")}"Lost ""reply"".","1","2026-11-02T10:00:00.500Z","",`
            + "\"ConversationGuide\",\"reactive\",\"501\",\"false\"",
        `"601","","9","301",${agent("agente")}"Why?","1","2026-11-02T10:00:01.000Z","",`
            + "\"ConversationGuide\",\"reactive\",\"501\",\"true\"",
        `"602","","9","301",${agent("agente")}"Five minutes left.","1","2026-11-02T10:05:01.000Z","",`
            + "\"ConversationGuide\",\"unknown\",\"\",\"true\"",
    ].join("\n")}\n`);
});

// The guide's evaluation of each origin, as ethicapp-ai-additions#303 sends it.
function guideEvaluation(respuesta, trigger, messageId) {
    return { agente: "ConversationGuide", respuesta, display_name: "agente", trigger, message_id: messageId };
}

function publishedGuideCallback({ id, receivedAt, evaluations, messageId, source = null, guideIndex = 0 }) {
    return callbackResult({
        id,
        receivedAt,
        source,
        evaluations,
        publishedMessages: [{
            messageId, agentName: "ConversationGuide", displayName: "agente", evaluationIndex: guideIndex,
        }],
    });
}

// A contentCoverage room through its life: a welcome, a reply to a mention,
// a time milestone, an inactivity prompt and an intervention a Validator
// decision asked for, whose Validator evaluation was not published.
function coverageRoom() {
    const constructive = example("constructive.es_CL.json");
    return {
        decisionId: constructive.decisionId,
        rows:       [
            guideSqlRow(6000, 80, "2026-11-18T17:00:01.000Z", "¡Hola!"),
            sqlRow(5000, "2026-11-18T17:01:00.000Z"),
            guideSqlRow(6001, 81, "2026-11-18T17:01:05.000Z", "Buena pregunta."),
            guideSqlRow(6002, 82, "2026-11-18T17:03:00.000Z", "Llevan la mitad del tiempo."),
            guideSqlRow(6003, 83, "2026-11-18T17:04:00.000Z", "¿Siguen ahí?"),
            guideSqlRow(6004, 84, "2026-11-18T17:05:13.000Z", "¿Y la supervisora?"),
        ],
        results: [
            publishedGuideCallback({
                id:          80,
                receivedAt:  "2026-11-18T17:00:00.500Z",
                messageId:   6000,
                evaluations: [guideEvaluation("¡Hola!", { kind: "session_start" }, 100)],
            }),
            publishedGuideCallback({
                id:          81,
                receivedAt:  "2026-11-18T17:01:04.000Z",
                messageId:   6001,
                source:      { kind: "chat_message", id: 5000 },
                evaluations: [guideEvaluation("Buena pregunta.", { kind: "mention" }, 101)],
            }),
            publishedGuideCallback({
                id:          82,
                receivedAt:  "2026-11-18T17:02:59.000Z",
                messageId:   6002,
                evaluations: [guideEvaluation("Llevan la mitad del tiempo.",
                    { kind: "time_milestone", milestone: 50 }, 102)],
            }),
            publishedGuideCallback({
                id:          83,
                receivedAt:  "2026-11-18T17:03:59.000Z",
                messageId:   6003,
                evaluations: [guideEvaluation("¿Siguen ahí?", { kind: "inactivity" }, 103)],
            }),
            publishedGuideCallback({
                id:          84,
                receivedAt:  "2026-11-18T17:05:12.500Z",
                messageId:   6004,
                guideIndex:  1,
                evaluations: [
                    {
                        agente:       "Validator",
                        respuesta:    "@ConversationGuide: CONSTRUCTIVE - T2 - ...",
                        display_name: "Validator",
                        trigger:      { kind: "adaptive_window", reason: "quiet_timeout" },
                        message_id:   null,
                    },
                    guideEvaluation("¿Y la supervisora?", {
                        kind: "adaptive_window", reason: "quiet_timeout", decision_id: constructive.decisionId,
                    }, 106),
                ],
            }),
        ],
        decisions: [storedDecision("constructive.es_CL.json", { interventionChatMessageId: 6004 })],
    };
}

test("guide messages export what made them: welcome, mention, milestone, inactivity, decision", async () => {
    const report = await exportTranscript(coverageRoom());

    const byId = new Map(report.rows.filter(row => row.id !== null).map(row => [row.id, row]));
    assert.deepEqual([6000, 6001, 6002, 6003, 6004].map(id => [
        id,
        byId.get(id).polyadic_agent_trigger,
        byId.get(id).polyadic_agent_in_reply_to,
    ]), [
        [6000, "session_start", null],
        // The answered message still comes from the callback's job.
        [6001, "mention", 5000],
        [6002, "time_milestone", null],
        [6003, "inactivity", null],
        [6004, "adaptive_window", null],
    ]);
    const kinds = [6000, 6002, 6003, 6004].map(id => byId.get(id).polyadic_agent_trigger);
    assert.equal(new Set(kinds).size, kinds.length, "proactive guide messages are told apart");
});

test("a decision-driven guide message and its decision row join both ways", async () => {
    const room = coverageRoom();
    const report = await exportTranscript(room);

    const guide = report.rows.find(row => row.id === 6004);
    const [decision] = report.rows.filter(row => row.polyadic_row_kind === "decision");
    assert.equal(guide.polyadic_agent_decision_id, room.decisionId);
    assert.equal(guide.polyadic_agent_decision_id, decision.polyadic_decision_id);
    assert.equal(decision.polyadic_decision_intervention_message_id, guide.id);
    // Other agent messages, and the decision row itself, name no decision.
    for (const row of report.rows.filter(other => other !== guide)) {
        assert.equal(row.polyadic_agent_decision_id, null);
    }
    const header = report.csv.slice(1, report.csv.indexOf("\n"));
    assert.match(header, /"polyadic_agent_visible_to_students","polyadic_agent_decision_id","polyadic_row_kind"/u);
});

test("an unpublished evaluation's row exports its own evaluation's trigger", async () => {
    const report = await exportTranscript(coverageRoom());

    const [validator] = report.rows.filter(row => row.polyadic_agent_visible_to_students === false
        && row.polyadic_row_kind === null);
    assert.equal(validator.name, "Validator");
    assert.equal(validator.polyadic_agent_trigger, "adaptive_window");
    assert.equal(validator.polyadic_agent_decision_id, null);

    // Two unpublished evaluations of one callback: each its own kind.
    const lost = await exportTranscript({
        rows:    [],
        results: [callbackResult({
            id:          85,
            receivedAt:  "2026-11-18T17:06:00.000Z",
            source:      { kind: "chat_message", id: 5000 },
            evaluations: [
                guideEvaluation("Lost reply.", { kind: "message" }, null),
                guideEvaluation("Lost window reply.", { kind: "window_full", reason: "max_messages" }, null),
                { agente: "ConversationGuide", respuesta: "Lost, no trigger." },
            ],
            publishedMessages: [],
        })],
    });
    assert.deepEqual(lost.rows.map(row => [row.message, row.polyadic_agent_trigger, row.polyadic_agent_in_reply_to]), [
        ["Lost reply.", "message", 5000],
        ["Lost window reply.", "window_full", 5000],
        ["Lost, no trigger.", AGENT_TRIGGER.REACTIVE, 5000],
    ]);
    assert.ok(lost.rows.every(row => !Object.hasOwn(row, "polyadic_agent_decision_id")),
        "a session without decisions does not get the decision link");
});

test("a malformed trigger exports unknown; a missing one keeps the callback's trigger", async () => {
    const triggers = [
        { kind: "Session_Start" },
        { kind: "1st" },
        { kind: "session-start" },
        { kind: "a".repeat(65) },
        { kind: 3 },
        { reason: "quiet_timeout" },
        {},
        "session_start",
        ["session_start"],
        null,
        undefined,
    ];
    const evaluations = triggers.map((trigger, index) => ({
        agente:    "Analista",
        respuesta: `Evaluation ${index}`,
        ...(trigger === undefined ? {} : { trigger }),
    }));
    const report = await exportTranscript({
        rows:    [],
        results: [callbackResult({
            id:                86,
            receivedAt:        "2026-11-18T17:07:00.000Z",
            source:            { kind: "chat_message", id: 5000 },
            evaluations,
            publishedMessages: [],
        })],
    });

    assert.deepEqual(report.rows.map(row => [row.polyadic_agent_trigger, row.polyadic_agent_in_reply_to]), [
        ...Array.from({ length: 9 }, () => [AGENT_TRIGGER.UNKNOWN, 5000]),
        [AGENT_TRIGGER.REACTIVE, 5000],
        [AGENT_TRIGGER.REACTIVE, 5000],
    ]);

    // The longest identifier is kept.
    const longest = await exportTranscript({
        rows:    [],
        results: [callbackResult({
            id:                87,
            receivedAt:        "2026-11-18T17:07:00.000Z",
            evaluations:       [{ agente: "Analista", respuesta: "Long", trigger: { kind: `a${"_".repeat(63)}` } }],
            publishedMessages: [],
        })],
    });
    assert.equal(longest.rows[0].polyadic_agent_trigger, `a${"_".repeat(63)}`);
});

test("a malformed decision id is left out of the decision link", async () => {
    const room = coverageRoom();
    room.results[4].rawPayload.evaluations[1].trigger.decision_id = "not-a-uuid";
    room.results[3].rawPayload.evaluations[0].trigger.decision_id = 42;

    const report = await exportTranscript(room);

    const guide = report.rows.find(row => row.id === 6004);
    assert.equal(guide.polyadic_agent_trigger, "adaptive_window");
    assert.equal(guide.polyadic_agent_decision_id, null);
    assert.equal(report.rows.find(row => row.id === 6003).polyadic_agent_decision_id, null);
});

test("messages published before #949 keep the callback's trigger", async () => {
    const room = coverageRoom();
    // No evaluationIndex: which evaluation the message came from is unknown.
    for (const result of room.results) {
        for (const entry of result.adapterResult.payload.publishedMessages) {
            delete entry.evaluationIndex;
        }
    }

    const report = await exportTranscript({ ...room, decisions: [] });

    const byId = new Map(report.rows.filter(row => row.id !== null).map(row => [row.id, row]));
    assert.equal(byId.get(6000).polyadic_agent_trigger, AGENT_TRIGGER.UNKNOWN);
    assert.equal(byId.get(6001).polyadic_agent_trigger, AGENT_TRIGGER.REACTIVE);
    assert.equal(byId.get(6001).polyadic_agent_in_reply_to, 5000);
});
