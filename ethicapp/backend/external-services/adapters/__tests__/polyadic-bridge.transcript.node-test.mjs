// The Polyadic bridge's chat transcript rows as the export writes them: the
// bridge's contribution through the real collector and generator, with the
// SQL rows of the report faked. Who wrote each contributed row (#1228, epic
// ethicapp-ai-additions#293).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { contributeToReport } from "../polyadic-bridge.adapter.js";
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
