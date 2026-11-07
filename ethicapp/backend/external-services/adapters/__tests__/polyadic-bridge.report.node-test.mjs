// The Polyadic bridge's report-building contribution to the chat transcript
// (epic #620, #949), validated against the real contract.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
    AGENT_TRIGGER,
    buildChatTranscriptContribution,
    contributeToReport,
    register,
    REPORT_COLUMNS,
    unpublishedEvaluations,
} from "../polyadic-bridge.adapter.js";
import { validateReportContribution } from "../../../services/external-service-report-contributions.js";

const SERVICE_ID = "polyadic-devils-advocate";
const SESSION_ID = 11;
const ROOM = "ethicapp-s11-p22-g301";

const manifest = JSON.parse(await fs.readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
const COLUMN_PREFIX = manifest.services.find(service => service.id === SERVICE_ID).report.columnPrefix;

// A result as the reader returns it, for a callback the handler completed.
function callbackResult({
    id,
    evaluations,
    publishedMessages,
    source = null,
    hookName = "phase-started",
    phaseId = 22,
    groupId = 301,
    questionId = 701,
    room = ROOM,
    receivedAt = "2026-11-02T10:00:00.000Z",
}) {
    return {
        id,
        jobId:         id + 1000,
        hookName,
        status:        "completed",
        phaseId,
        questionId,
        groupId,
        userId:        null,
        source,
        rawPayload:    { room, evaluations },
        adapterResult: {
            serviceId: SERVICE_ID,
            hook:      "callback-received",
            status:    "completed",
            payload:   {
                room,
                evaluationsReceived: evaluations.length,
                messagesPublished:   publishedMessages.length,
                publishedMessages,
            },
        },
        receivedAt,
    };
}

function studentRow(messageId, time) {
    return {
        messageId,
        phaseId:                 22,
        questionId:              701,
        groupId:                 301,
        userId:                  41,
        externalServiceId:       null,
        externalServiceResultId: null,
        time,
    };
}

function agentRow(messageId, resultId, time) {
    return {
        messageId,
        phaseId:                 22,
        questionId:              701,
        groupId:                 301,
        userId:                  null,
        externalServiceId:       SERVICE_ID,
        externalServiceResultId: resultId,
        time,
    };
}

function contextOf(rows) {
    return { reportType: "chat_transcript", serviceId: SERVICE_ID, sessionId: SESSION_ID, rows };
}

function validate(contribution, rows) {
    return validateReportContribution(contribution, {
        reportType:   "chat_transcript",
        rowKeys:      new Map(rows.map(row => [String(row.messageId), row.messageId])),
        columnPrefix: COLUMN_PREFIX,
    });
}

function valuesByRow(contribution) {
    return new Map(contribution.values.map(entry => [entry.rowKey, entry.values]));
}

test("the manifest subscribes the bridge to report-building with its column prefix", async () => {
    const entry = manifest.services.find(service => service.id === SERVICE_ID);
    assert.ok(entry.hooks.includes("report-building"));
    assert.deepEqual(entry.report, { columnPrefix: "polyadic_" });

    const handlers = new Map();
    await register({
        service:                 { id: SERVICE_ID },
        subscribe:               (hookName, handler) => handlers.set(hookName, handler),
        publishGroupChatMessage: async () => null,
    });
    assert.equal(handlers.get("report-building"), contributeToReport);
});

test("published messages get the agent, the trigger and visible_to_students", () => {
    const rows = [
        studentRow(501, "2026-11-02T09:59:00.000Z"),
        agentRow(601, 90, "2026-11-02T10:00:01.000Z"),
        agentRow(602, 90, "2026-11-02T10:00:02.000Z"),
    ];
    const results = [callbackResult({
        id:          90,
        evaluations: [
            { agente: "ConversationGuide", respuesta: "Welcome." },
            { agente: "Orientador", respuesta: "Think about the stakeholders." },
        ],
        publishedMessages: [
            { messageId: 601, agentName: "ConversationGuide" },
            { messageId: 602, agentName: "Orientador" },
        ],
    })];

    const contribution = buildChatTranscriptContribution(contextOf(rows), results);
    const byRow = valuesByRow(contribution);

    assert.deepEqual(contribution.columns.map(column => column.id), [
        REPORT_COLUMNS.AGENT_NAME,
        REPORT_COLUMNS.TRIGGER,
        REPORT_COLUMNS.IN_REPLY_TO,
        REPORT_COLUMNS.VISIBLE_TO_STUDENTS,
    ]);
    assert.equal(byRow.has(501), false, "student rows get no values");
    assert.deepEqual(byRow.get(601), {
        polyadic_agent_name:                "ConversationGuide",
        polyadic_agent_trigger:             AGENT_TRIGGER.UNKNOWN,
        polyadic_agent_in_reply_to:         null,
        polyadic_agent_visible_to_students: true,
    });
    assert.equal(byRow.get(602).polyadic_agent_name, "Orientador");
    assert.deepEqual(contribution.rows, []);
    assert.equal(validate(contribution, rows).valid, true);
});

test("unpublished evaluations become rows at the result's time, not visible to students", () => {
    const rows = [
        studentRow(501, "2026-11-02T09:59:00.000Z"),
        agentRow(601, 90, "2026-11-02T10:00:01.000Z"),
    ];
    const results = [callbackResult({
        id:          90,
        evaluations: [
            { agente: "Analista", respuesta: "The group agrees too fast.", mensajes_evaluados: ["Ana: ok"] },
            { agente: "ConversationGuide", respuesta: "What would change your mind?" },
            { agente: "Moderador", respuesta: "   " },
        ],
        publishedMessages: [{ messageId: 601, agentName: "ConversationGuide" }],
        source:            { kind: "chat_message", id: 501 },
        hookName:          "chat-message-received",
    })];

    const contribution = buildChatTranscriptContribution(contextOf(rows), results);

    assert.deepEqual(contribution.rows, [{
        phaseId:    22,
        groupId:    301,
        questionId: 701,
        time:       "2026-11-02T10:00:00.000Z",
        message:    "The group agrees too fast.",
        values:     {
            polyadic_agent_name:                "Analista",
            polyadic_agent_trigger:             AGENT_TRIGGER.REACTIVE,
            polyadic_agent_in_reply_to:         501,
            polyadic_agent_visible_to_students: false,
        },
    }]);
    assert.doesNotMatch(JSON.stringify(contribution), /Ana: ok/, "mensajes_evaluados is not exported");
    assert.equal(validate(contribution, rows).valid, true);
});

test("a published evaluation is not added again as a row", () => {
    const rows = [agentRow(601, 90, "2026-11-02T10:00:01.000Z"), agentRow(602, 90, "2026-11-02T10:00:02.000Z")];
    const results = [callbackResult({
        id:          90,
        evaluations: [
            { agente: "ConversationGuide", respuesta: "First." },
            { agente: "conversationguide", respuesta: "Second." },
        ],
        publishedMessages: [
            { messageId: 601, agentName: "ConversationGuide" },
            { messageId: 602, agentName: "conversationguide" },
        ],
    })];

    const contribution = buildChatTranscriptContribution(contextOf(rows), results);

    assert.deepEqual(contribution.rows, []);
    assert.equal(contribution.values.length, 2);
    assert.equal(validate(contribution, rows).valid, true);
});

test("a chat agent's evaluation whose publication failed is a row, not visible to students", () => {
    assert.deepEqual(unpublishedEvaluations(
        [
            { agente: "ConversationGuide", respuesta: "Lost." },
            { agente: "Orientador", respuesta: "Shown." },
        ],
        [{ messageId: 602, agentName: "Orientador" }]
    ), [{ agentName: "ConversationGuide", content: "Lost." }]);
});

test("legacy messages without a result link, and results without published messages, add nothing", () => {
    const rows = [studentRow(501, "2026-11-02T09:59:00.000Z"), agentRow(601, null, "2026-11-02T10:00:01.000Z")];
    const legacy = callbackResult({
        id:                80,
        evaluations:       [{ agente: "Analista", respuesta: "Before #947." }],
        publishedMessages: [],
    });
    // Before #947 the handler's payload listed no published messages.
    delete legacy.adapterResult.payload.publishedMessages;

    const contribution = buildChatTranscriptContribution(contextOf(rows), [legacy]);

    assert.deepEqual(contribution.values, []);
    assert.deepEqual(contribution.rows, []);
    assert.equal(contribution.columns.length, 4);
    assert.equal(validate(contribution, rows).valid, true);
});

test("a failed callback adds nothing", () => {
    const failed = callbackResult({
        id:                81,
        evaluations:       [{ agente: "Analista", respuesta: "Refused." }],
        publishedMessages: [],
    });
    failed.adapterResult.status = "failed";

    const contribution = buildChatTranscriptContribution(contextOf([]), [failed]);
    assert.deepEqual(contribution.rows, []);
});

test("only a message-correlated result is reactive and names the message it answered", () => {
    const rows = [
        studentRow(501, "2026-11-02T09:59:00.000Z"),
        agentRow(601, 90, "2026-11-02T10:00:01.000Z"),
        agentRow(602, 91, "2026-11-02T10:05:01.000Z"),
        agentRow(603, 92, "2026-11-02T10:06:01.000Z"),
    ];
    const results = [
        // Correlated with the student message's chat-message-received job.
        callbackResult({
            id:                90,
            hookName:          "chat-message-received",
            source:            { kind: "chat_message", id: 501 },
            evaluations:       [{ agente: "ConversationGuide", respuesta: "Reply." }],
            publishedMessages: [{ messageId: 601, agentName: "ConversationGuide" }],
        }),
        // Correlated with the room job: proactive or a window-event reply.
        callbackResult({
            id:                91,
            hookName:          "phase-started",
            evaluations:       [{ agente: "ConversationGuide", respuesta: "Five minutes left." }],
            publishedMessages: [{ messageId: 602, agentName: "ConversationGuide" }],
        }),
        // A room job created when a chat message found no room: its hook is
        // chat-message-received, but it records no source.
        callbackResult({
            id:                92,
            hookName:          "chat-message-received",
            evaluations:       [{ agente: "ConversationGuide", respuesta: "Hello." }],
            publishedMessages: [{ messageId: 603, agentName: "ConversationGuide" }],
        }),
    ];

    const byRow = valuesByRow(buildChatTranscriptContribution(contextOf(rows), results));

    assert.equal(byRow.get(601).polyadic_agent_trigger, AGENT_TRIGGER.REACTIVE);
    assert.equal(byRow.get(601).polyadic_agent_in_reply_to, 501);
    assert.equal(byRow.get(602).polyadic_agent_trigger, AGENT_TRIGGER.UNKNOWN);
    assert.equal(byRow.get(602).polyadic_agent_in_reply_to, null);
    assert.equal(byRow.get(603).polyadic_agent_trigger, AGENT_TRIGGER.UNKNOWN);
    assert.equal(byRow.get(603).polyadic_agent_in_reply_to, null);
});

test("a result without a job places its rows in its room, only within the session", () => {
    const uncorrelated = callbackResult({
        id:                93,
        hookName:          null,
        phaseId:           null,
        groupId:           null,
        questionId:        null,
        evaluations:       [{ agente: "Analista", respuesta: "Quiet room." }],
        publishedMessages: [],
    });
    uncorrelated.jobId = null;
    const otherSession = callbackResult({
        id:                94,
        hookName:          null,
        phaseId:           null,
        groupId:           null,
        room:              "ethicapp-s12-p22-g301",
        evaluations:       [{ agente: "Analista", respuesta: "Elsewhere." }],
        publishedMessages: [],
    });

    const contribution = buildChatTranscriptContribution(contextOf([]), [uncorrelated, otherSession]);

    assert.deepEqual(contribution.rows.map(row => [row.phaseId, row.groupId, row.questionId, row.message]), [
        [22, 301, null, "Quiet room."],
    ]);
    assert.equal(contribution.rows[0].values.polyadic_agent_trigger, AGENT_TRIGGER.UNKNOWN);
    assert.equal(validate(contribution, []).valid, true);
});

test("an over-long evaluation is cut to the contract's limit", () => {
    const results = [callbackResult({
        id:                95,
        evaluations:       [{ agente: "Analista", respuesta: "x".repeat(12000) }],
        publishedMessages: [],
    })];

    const contribution = buildChatTranscriptContribution(contextOf([]), results);
    assert.equal(contribution.rows[0].message.length, 10000);
    assert.equal(validate(contribution, []).valid, true);
});

test("the handler contributes to the chat transcript only, from the scoped reader", async () => {
    const listed = [];
    const results = {
        list: async filters => {
            listed.push(filters);
            return [callbackResult({
                id:                90,
                evaluations:       [{ agente: "Analista", respuesta: "Hidden." }],
                publishedMessages: [],
            })];
        },
    };

    assert.equal(await contributeToReport({ ...contextOf([]), reportType: "responses" }, { results }), null);
    assert.deepEqual(listed, []);

    const contribution = await contributeToReport(contextOf([]), { results });
    assert.equal(contribution.rows.length, 1);
    assert.deepEqual(listed, [undefined]);
});

// Runs the real callback-received handler with the given publication
// outcomes, and returns the result the reader would list for that callback.
async function handledCallbackResult({ id, requestPayload, publications }) {
    const handlers = new Map();
    const outcomes = [...publications];
    let adapterResult = null;
    await register({
        service:                    { id: SERVICE_ID },
        subscribe:                  (hookName, handler) => handlers.set(hookName, handler),
        publishGroupChatMessage:    async () => outcomes.shift() ?? null,
        aiAdditionsClient:          { getEndpoints: async () => ({}), requestJson: async () => ({}) },
        polyadicBridgeDependencies: { getFirstQuestionIdForPhase: async () => 701 },
    });
    await handlers.get("callback-received")({ resultId: id, requestPayload }, {
        callback: async result => {
            adapterResult = result;
            return result;
        },
    });
    return {
        ...callbackResult({ id, evaluations: [], publishedMessages: [] }),
        rawPayload: requestPayload,
        adapterResult,
    };
}

const SAME_AGENT_PAYLOAD = Object.freeze({
    room:        ROOM,
    evaluations: [
        { agente: "ConversationGuide", respuesta: "FIRST" },
        { agente: "ConversationGuide", respuesta: "SECOND" },
    ],
});

test("two evaluations of one agent, only the second published: each appears once", async () => {
    const result = await handledCallbackResult({
        id:             90,
        requestPayload: SAME_AGENT_PAYLOAD,
        publications:   [null, { savedMessage: { id: 602 } }],
    });
    assert.deepEqual(result.adapterResult.payload.publishedMessages, [
        { messageId: 602, agentName: "ConversationGuide", displayName: "ConversationGuide", evaluationIndex: 1 },
    ]);

    const rows = [agentRow(602, 90, "2026-11-02T10:00:01.000Z")];
    const contribution = buildChatTranscriptContribution(contextOf(rows), [result]);

    assert.deepEqual(
        contribution.rows.map(row => [row.message, row.values.polyadic_agent_visible_to_students]),
        [["FIRST", false]]
    );
    assert.deepEqual(contribution.values, [{
        rowKey: 602,
        values: {
            polyadic_agent_name:                "ConversationGuide",
            polyadic_agent_trigger:             AGENT_TRIGGER.UNKNOWN,
            polyadic_agent_in_reply_to:         null,
            polyadic_agent_visible_to_students: true,
        },
    }]);
    assert.doesNotMatch(JSON.stringify(contribution.rows), /SECOND/);
    assert.equal(validate(contribution, rows).valid, true);
});

test("old metadata without evaluationIndex adds nothing for an ambiguous agent", () => {
    const rows = [agentRow(602, 90, "2026-11-02T10:00:01.000Z")];
    const results = [callbackResult({
        id:          90,
        evaluations: [
            ...SAME_AGENT_PAYLOAD.evaluations,
            { agente: "Orientador", respuesta: "Not published." },
            { agente: "Analista", respuesta: "Hidden analysis." },
        ],
        publishedMessages: [{ messageId: 602, agentName: "ConversationGuide" }],
    })];

    const contribution = buildChatTranscriptContribution(contextOf(rows), results);

    // ConversationGuide has two evaluations and one published message, and
    // which one was published is unknown, so neither is added. Orientador
    // published nothing; Analista is not a chat agent.
    assert.deepEqual(contribution.rows.map(row => row.message), ["Not published.", "Hidden analysis."]);
    assert.equal(contribution.values.length, 1);
    assert.equal(validate(contribution, rows).valid, true);
});

test("indexed metadata: every evaluation not published is a row exactly once", () => {
    assert.deepEqual(unpublishedEvaluations(
        [
            { agente: "ConversationGuide", respuesta: "A" },
            { agente: "Analista", respuesta: "B" },
            { agente: "ConversationGuide", respuesta: "C" },
            { agente: "ConversationGuide", respuesta: "D" },
        ],
        [
            { messageId: 601, agentName: "ConversationGuide", evaluationIndex: 0 },
            { messageId: 603, agentName: "ConversationGuide", evaluationIndex: 3 },
        ]
    ), [
        { agentName: "Analista", content: "B" },
        { agentName: "ConversationGuide", content: "C" },
    ]);
});
