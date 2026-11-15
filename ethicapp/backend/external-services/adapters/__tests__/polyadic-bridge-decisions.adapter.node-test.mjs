// The Polyadic bridge and the mediation decisions of contentCoverage rooms
// (#1222, epic ethicapp-ai-additions#293): the callback stores them, the
// chat transcript exports them.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    buildChatTranscriptContribution,
    contributeToReport,
    register,
    REPORT_COLUMNS,
} from "../polyadic-bridge.adapter.js";
import {
    DECISION_REPORT_COLUMNS,
    DECISION_STORAGE,
    interventionChatMessageIdOf,
    resolveRoomTopics,
    ROOM_TOPICS_STATUS,
    storeCallbackDecisions,
} from "../polyadic-bridge.decisions.js";
import { validateReportContribution } from "../../../services/external-service-report-contributions.js";

const SERVICE_ID = "polyadic-devils-advocate";
const ROOM = "ethicapp-s11-p22-g301";
const RESULT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ROOM_JOB_ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";

const EXAMPLES_URL = new URL(
    "../../../../../canonical-schemas/ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);
const manifest = JSON.parse(await fs.readFile(new URL("../../manifest.json", import.meta.url), "utf8"));
const COLUMN_PREFIX = manifest.services.find(service => service.id === SERVICE_ID).report.columnPrefix;

function example(name) {
    return JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
}

function createHarness({ store = undefined } = {}) {
    const subscribers = new Map();
    const callbacks = [];
    const publishedMessages = [];
    const recorded = [];
    const mediationDecisions = store === undefined
        ? {
            async record(args) {
                recorded.push(args);
                return { stored: args.decisions.map(({ record }) => record.decisionId), duplicates: [] };
            },
        }
        : store;

    return {
        callbacks,
        publishedMessages,
        recorded,
        async initialize() {
            await register({
                service: { id: SERVICE_ID },
                subscribe(hookName, handler) {
                    subscribers.set(hookName, handler);
                },
                async publishGroupChatMessage(payload) {
                    publishedMessages.push(payload);
                    return { savedMessage: { id: 9000 + publishedMessages.length } };
                },
                aiAdditionsClient:          { requestJson: async () => ({}) },
                mediationDecisions,
                polyadicBridgeDependencies: { getFirstQuestionIdForPhase: async () => 701 },
            });
        },
        async dispatch(context) {
            await subscribers.get("callback-received")(context, {
                callback: async result => {
                    callbacks.push(result);
                    return result;
                },
            });
            return callbacks.at(-1);
        },
    };
}

function silenceConsole(t) {
    const lines = [];
    for (const level of ["warn", "error", "info"]) {
        t.mock.method(console, level, (...args) => lines.push(args.join(" ")));
    }
    return lines;
}

// ─── The callback ───────────────────────────────────────────────────────────

test("a callback with decisions only is stored, no longer refused as invalid", async t => {
    silenceConsole(t);
    const harness = createHarness();
    await harness.initialize();
    const record = example("no-intervention.es_CL.json");

    const result = await harness.dispatch({
        resultId:       RESULT_ID,
        jobId:          ROOM_JOB_ID,
        requestPayload: { room: ROOM, evaluations: [], decisions: [record] },
    });

    assert.equal(harness.publishedMessages.length, 0);
    assert.deepEqual(harness.recorded, [{
        sessionId:  11,
        phaseId:    22,
        questionId: 701,
        groupId:    301,
        jobId:      ROOM_JOB_ID,
        resultId:   RESULT_ID,
        decisions:  [{ record, interventionChatMessageId: null }],
    }]);
    assert.deepEqual(result, {
        serviceId: SERVICE_ID,
        hook:      "callback-received",
        status:    "completed",
        payload:   {
            room:                ROOM,
            evaluationsReceived: 0,
            messagesPublished:   0,
            publishedMessages:   [],
            decisions:           {
                received:   1,
                stored:     [record.decisionId],
                duplicates: [],
                invalid:    [],
            },
        },
    });
});

test("a callback with neither evaluations nor decisions is still invalid", async () => {
    for (const requestPayload of [
        { room: ROOM, evaluations: [] },
        { room: ROOM, evaluations: [], decisions: [] },
        { room: ROOM, decisions: "none" },
        { evaluations: [], decisions: [example("no-intervention.es_CL.json")] },
    ]) {
        const harness = createHarness();
        await harness.initialize();
        const result = await harness.dispatch({ requestPayload });
        assert.deepEqual(result, {
            serviceId: SERVICE_ID,
            hook:      "callback-received",
            status:    "failed",
            payload:   { reason: "invalid_payload" },
        }, JSON.stringify(requestPayload));
        assert.equal(harness.recorded.length, 0);
    }
});

test("an intervention is tied to the message the guide posted from the same callback", async t => {
    silenceConsole(t);
    const harness = createHarness();
    await harness.initialize();
    const record = example("constructive.es_CL.json");

    const result = await harness.dispatch({
        resultId:       RESULT_ID,
        requestPayload: {
            room:        ROOM,
            evaluations: [{ agente: "ConversationGuide", respuesta: "¿Cómo pesa la evaluación?", display_name: "agente" }],
            decisions:   [record],
        },
    });

    assert.equal(harness.publishedMessages.length, 1);
    assert.deepEqual(harness.recorded[0].decisions, [{ record, interventionChatMessageId: 9001 }]);
    assert.equal(harness.recorded[0].jobId, null);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.payload.publishedMessages, [
        { messageId: 9001, agentName: "ConversationGuide", displayName: "agente", evaluationIndex: 0 },
    ]);
    assert.deepEqual(result.payload.decisions.stored, [record.decisionId]);
});

test("an invalid record is skipped and logged by ids only; the rest is processed", async t => {
    const lines = silenceConsole(t);
    const harness = createHarness();
    await harness.initialize();
    const invalid = example("stuck-suppressed.es_CL.json");
    invalid.reason = "Ana escribió: firmar está mal";
    invalid.intervention.messageId = 130;
    const valid = example("no-intervention.es_CL.json");

    const result = await harness.dispatch({
        resultId:       RESULT_ID,
        requestPayload: {
            room:        ROOM,
            evaluations: [{ agente: "ConversationGuide", respuesta: "Pregunta" }],
            decisions:   [invalid, "not a record", valid],
        },
    });

    assert.equal(harness.publishedMessages.length, 1);
    assert.deepEqual(harness.recorded[0].decisions.map(({ record }) => record.decisionId), [valid.decisionId]);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.payload.decisions.invalid, [
        {
            index:      0,
            decisionId: invalid.decisionId,
            problems:   [{ code: "intervention_mismatch", path: "intervention.messageId" }],
        },
        {
            index:      1,
            decisionId: null,
            problems:   [{ code: "schema_violation", path: "<root>", keyword: "type" }],
        },
    ]);
    assert.ok(lines.some(line => line.includes("Skipped an invalid mediation decision")));
    assert.equal(lines.some(line => line.includes("Ana") || line.includes("not a record")), false);
});

test("a decision delivered again is a duplicate, not a failure", async t => {
    silenceConsole(t);
    const record = example("unparsed.en_US.json");
    const harness = createHarness({
        store: { record: async () => ({ stored: [], duplicates: [record.decisionId] }) },
    });
    await harness.initialize();

    const result = await harness.dispatch({ requestPayload: { room: ROOM, evaluations: [], decisions: [record] } });

    assert.equal(result.status, "completed");
    assert.deepEqual(result.payload.decisions.duplicates, [record.decisionId]);
});

test("a failed store fails a decisions-only callback, not one that published messages", async t => {
    const lines = silenceConsole(t);
    const record = example("no-intervention.es_CL.json");
    const store = { record: async () => {
        throw Object.assign(new Error("connection terminated"), { code: "57P01" });
    } };

    const harness = createHarness({ store });
    await harness.initialize();
    const only = await harness.dispatch({ requestPayload: { room: ROOM, evaluations: [], decisions: [record] } });
    assert.equal(only.status, "failed");
    assert.equal(only.payload.decisions.storage, DECISION_STORAGE.FAILED);

    const withMessage = await harness.dispatch({
        requestPayload: {
            room:        ROOM,
            evaluations: [{ agente: "ConversationGuide", respuesta: "Pregunta" }],
            decisions:   [record],
        },
    });
    assert.equal(withMessage.status, "completed");
    assert.equal(withMessage.payload.messagesPublished, 1);
    assert.equal(withMessage.payload.decisions.storage, DECISION_STORAGE.FAILED);
    assert.ok(lines.some(line => line.includes("Could not store the mediation decisions")
        && line.includes(record.decisionId)));
    assert.equal(lines.some(line => line.includes(record.reason)), false);
});

test("without a store the records are validated and reported unavailable", async t => {
    silenceConsole(t);
    const harness = createHarness({ store: null });
    await harness.initialize();
    const result = await harness.dispatch({
        requestPayload: {
            room:        ROOM,
            evaluations: [{ agente: "ConversationGuide", respuesta: "Pregunta" }],
            decisions:   [example("no-intervention.es_CL.json")],
        },
    });
    assert.equal(result.status, "completed");
    assert.equal(result.payload.decisions.storage, DECISION_STORAGE.UNAVAILABLE);
});

test("a callback without decisions keeps its result exactly", async () => {
    const harness = createHarness();
    await harness.initialize();
    const result = await harness.dispatch({
        resultId:       RESULT_ID,
        requestPayload: { room: ROOM, evaluations: [{ agente: "ConversationGuide", respuesta: "Why?" }] },
    });
    assert.deepEqual(result, {
        serviceId: SERVICE_ID,
        hook:      "callback-received",
        status:    "completed",
        payload:   {
            room:                ROOM,
            evaluationsReceived: 1,
            messagesPublished:   1,
            publishedMessages:   [
                { messageId: 9001, agentName: "ConversationGuide", displayName: "ConversationGuide", evaluationIndex: 0 },
            ],
        },
    });
    assert.equal(harness.recorded.length, 0);
});

test("the intervention message is resolved only when it is unambiguous", () => {
    const record = example("constructive.es_CL.json");
    const saved = (id, agentName) => ({ message: { id }, agentName });
    assert.equal(interventionChatMessageIdOf(record, [saved(7, "ConversationGuide")]), 7);
    assert.equal(interventionChatMessageIdOf(record, [saved(7, "Orientador")]), null);
    assert.equal(interventionChatMessageIdOf(record, [saved(7, "ConversationGuide"), saved(8, "ConversationGuide")]), null);
    assert.equal(interventionChatMessageIdOf(example("stuck-suppressed.es_CL.json"), [saved(7, "ConversationGuide")]), null);
});

test("storeCallbackDecisions records indexes and codes only", async () => {
    const warnings = [];
    const outcome = await storeCallbackDecisions({
        decisions: [{ schemaVersion: "mediation-decision/v1", reason: "Beto dijo algo" }],
        room:      ROOM,
        placement: { sessionId: 11, phaseId: 22, questionId: 701, groupId: 301 },
        store:     { record: async () => assert.fail("nothing valid to store") },
        logger:    { warn: (...args) => warnings.push(args.join(" ")) },
    });
    assert.equal(outcome.invalid.length, 1);
    assert.equal(outcome.invalid[0].decisionId, null);
    assert.ok(outcome.invalid[0].problems.every(problem => typeof problem.code === "string"));
    assert.equal(JSON.stringify(outcome).includes("Beto"), false);
    assert.equal(warnings.some(line => line.includes("Beto")), false);
});

// ─── The chat transcript ────────────────────────────────────────────────────

const TOPICS_RECORD = Object.freeze({
    key:            "discussion_topics",
    serviceId:      "case-analyst-topic-listing",
    caseId:         51,
    documentSchema: "topic-listing/v1",
    pointer:        "/topics",
    jobId:          "9b0c7a10-1111-4222-8333-444455556666",
    generatedAt:    "2026-11-14T09:30:00.000Z",
    reviewedAt:     null,
    ids:            ["T1", "T2", "T3"],
});

const LISTING_ROW = Object.freeze({
    job_id:       TOPICS_RECORD.jobId,
    generated_at: new Date(TOPICS_RECORD.generatedAt),
    reviewed_at:  null,
    document:     {
        schemaVersion: "topic-listing/v1",
        topics:        [
            { id: "T1", topic: "Veracidad del registro" },
            { id: "T2", topic: "Presión jerárquica y evaluación" },
            { id: "T3", topic: "Costos personales de denunciar" },
        ],
    },
});

const ROOM_JOB = Object.freeze({
    id:                  ROOM_JOB_ID,
    kind:                "room",
    createdAt:           "2026-11-18T17:00:00.000Z",
    instantiationReport: { warnings: [], degraded: false, configurationRejected: false, caseInputs: [TOPICS_RECORD] },
});

function storedDecision(name, overrides = {}) {
    const record = example(name);
    return {
        id:                        name,
        decisionId:                record.decisionId,
        phaseId:                   22,
        questionId:                701,
        groupId:                   301,
        resultId:                  RESULT_ID,
        record,
        windowChatMessageIds:      record.window.messages.map((_, index) => 5000 + index),
        interventionChatMessageId: record.intervention.status === "intervened" ? 6001 : null,
        decidedAt:                 new Date(record.decidedAt).toISOString(),
        receivedAt:                null,
        job:                       ROOM_JOB,
        ...overrides,
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
        externalAgentName:       null,
        time,
    };
}

function contextOf(rows) {
    return { reportType: "chat_transcript", serviceId: SERVICE_ID, sessionId: 11, rows };
}

function validate(contribution, rows) {
    return validateReportContribution(contribution, {
        reportType:   "chat_transcript",
        rowKeys:      new Map(rows.map(row => [String(row.messageId), row.messageId])),
        columnPrefix: COLUMN_PREFIX,
    });
}

const LEGACY_COLUMNS = [
    "polyadic_agent_name",
    "polyadic_agent_trigger",
    "polyadic_agent_in_reply_to",
    "polyadic_agent_visible_to_students",
];

const DECISION_COLUMNS = [
    "polyadic_row_kind",
    "polyadic_decision_id",
    "polyadic_decision_pipeline_type",
    "polyadic_decision",
    "polyadic_decision_category",
    "polyadic_decision_topic_id",
    "polyadic_decision_topic_name",
    "polyadic_decision_reason",
    "polyadic_decision_trigger_kind",
    "polyadic_decision_trigger_reason",
    "polyadic_decision_window_message_ids",
    "polyadic_decision_window_polyadic_message_ids",
    "polyadic_decision_intervention_status",
    "polyadic_decision_intervention_agent",
    "polyadic_decision_intervention_message_id",
    "polyadic_decision_intervention_polyadic_message_id",
    "polyadic_decision_intervention_suppressed_by",
    "polyadic_decision_decided_at",
    "polyadic_room_topics",
    "polyadic_room_topics_status",
];

test("the decision columns have stable names", () => {
    assert.deepEqual(Object.values(DECISION_REPORT_COLUMNS), DECISION_COLUMNS);
});

test("a session without decisions keeps its contribution exactly", async () => {
    const rows = [studentRow(501, "2026-11-02T09:59:00.000Z")];
    const results = [];
    const reader = { list: async () => results, mediationDecisions: async () => [] };

    const contribution = await contributeToReport(contextOf(rows), { results: reader }, {
        getCaseAnalysis: async () => assert.fail("no listing is read without decisions"),
    });

    assert.deepEqual(contribution, buildChatTranscriptContribution(contextOf(rows), results));
    assert.deepEqual(contribution, {
        columns: [
            { id: "polyadic_agent_name",                label: "Polyadic agent" },
            { id: "polyadic_agent_trigger",             label: "Polyadic agent trigger" },
            { id: "polyadic_agent_in_reply_to",         label: "Student message answered" },
            { id: "polyadic_agent_visible_to_students", label: "Visible to students" },
        ],
        values: [],
        rows:   [],
    });

    // A reader without decisions (an older registry) gives the same.
    assert.deepEqual(
        await contributeToReport(contextOf(rows), { results: { list: async () => results } }),
        contribution
    );
});

test("every decision is a row next to the transcript, no_intervention included", async () => {
    const rows = [studentRow(5000, "2026-11-18T17:04:00.000Z")];
    const decisions = [
        storedDecision("constructive.es_CL.json"),
        storedDecision("stuck-suppressed.es_CL.json"),
        storedDecision("no-intervention.es_CL.json"),
        storedDecision("unparsed.en_US.json", { windowChatMessageIds: [null, null, null] }),
    ];
    const reader = { list: async () => [], mediationDecisions: async () => decisions };

    const contribution = await contributeToReport(contextOf(rows), { results: reader }, {
        getCaseAnalysis: async ({ caseId, serviceId }) => {
            assert.deepEqual({ caseId, serviceId }, { caseId: 51, serviceId: "case-analyst-topic-listing" });
            return LISTING_ROW;
        },
    });

    const validation = validate(contribution, rows);
    assert.equal(validation.valid, true, JSON.stringify(validation.problems));
    assert.deepEqual(contribution.columns.map(column => column.id), [...LEGACY_COLUMNS, ...DECISION_COLUMNS]);
    assert.deepEqual(contribution.values, []);
    assert.equal(contribution.rows.length, 5);

    const [constructive, stuck, noIntervention, unparsed, topics] = contribution.rows;
    assert.deepEqual(constructive, {
        phaseId:    22,
        questionId: 701,
        groupId:    301,
        time:       "2026-11-18T17:05:12.000Z",
        message:    null,
        values:     {
            [REPORT_COLUMNS.AGENT_NAME]:                           "Validator",
            [REPORT_COLUMNS.TRIGGER]:                              null,
            [REPORT_COLUMNS.IN_REPLY_TO]:                          null,
            [REPORT_COLUMNS.VISIBLE_TO_STUDENTS]:                  false,
            polyadic_row_kind:                                     "decision",
            polyadic_decision_id:                                  "0b9e8a52-7a1f-4f7e-9d43-5c1e2f3a4b01",
            polyadic_decision_pipeline_type:                       "contentCoverage",
            polyadic_decision:                                     "intervene",
            polyadic_decision_category:                            "CONSTRUCTIVE",
            polyadic_decision_topic_id:                            "T2",
            polyadic_decision_topic_name:                          "Presión jerárquica y evaluación",
            polyadic_decision_reason:                              example("constructive.es_CL.json").reason,
            polyadic_decision_trigger_kind:                        "adaptive_window",
            polyadic_decision_trigger_reason:                      "quiet_timeout",
            polyadic_decision_window_message_ids:                  "[5000,5001,5002,5003]",
            polyadic_decision_window_polyadic_message_ids:         "[101,102,104,105]",
            polyadic_decision_intervention_status:                 "intervened",
            polyadic_decision_intervention_agent:                  "ConversationGuide",
            polyadic_decision_intervention_message_id:             6001,
            polyadic_decision_intervention_polyadic_message_id:    106,
            polyadic_decision_intervention_suppressed_by:          null,
            polyadic_decision_decided_at:                          "2026-11-18T14:05:12-03:00",
        },
    });
    assert.equal(stuck.values.polyadic_decision_intervention_status, "suppressed");
    assert.equal(stuck.values.polyadic_decision_intervention_suppressed_by, "cooldown");
    assert.equal(stuck.values.polyadic_decision_intervention_message_id, null);
    assert.equal(noIntervention.values.polyadic_decision, "no_intervention");
    assert.equal(noIntervention.values.polyadic_decision_topic_id, null);
    assert.equal(noIntervention.values.polyadic_decision_trigger_reason, "max_wait");
    assert.equal(unparsed.values.polyadic_decision, "unparsed");
    assert.equal(unparsed.values.polyadic_decision_window_message_ids, "[null,null,null]");

    assert.deepEqual(topics, {
        phaseId:    22,
        questionId: 701,
        groupId:    301,
        time:       "2026-11-18T17:00:00.000Z",
        message:    null,
        values:     {
            polyadic_row_kind:           "room_topics",
            polyadic_room_topics:        JSON.stringify([
                { id: "T1", name: "Veracidad del registro" },
                { id: "T2", name: "Presión jerárquica y evaluación" },
                { id: "T3", name: "Costos personales de denunciar" },
            ]),
            polyadic_room_topics_status: "as_sent",
        },
    });
});

test("decision rows sit beside the transcript's own contributed rows", () => {
    const rows = [{ ...studentRow(601, "2026-11-18T17:05:13.000Z"), userId: null,
        externalServiceId: SERVICE_ID, externalServiceResultId: RESULT_ID }];
    const results = [{
        id:            RESULT_ID,
        jobId:         ROOM_JOB_ID,
        hookName:      "phase-started",
        status:        "completed",
        phaseId:       22,
        questionId:    701,
        groupId:       301,
        userId:        null,
        source:        null,
        rawPayload:    { room: ROOM, evaluations: [{ agente: "ConversationGuide", respuesta: "¿Y la supervisora?" }] },
        adapterResult: { hook: "callback-received", status: "completed", payload: {
            publishedMessages: [{ messageId: 601, agentName: "ConversationGuide", evaluationIndex: 0 }],
        } },
        receivedAt:    "2026-11-18T17:05:13.000Z",
    }];
    const contribution = buildChatTranscriptContribution(contextOf(rows), results, {
        decisions:  [storedDecision("constructive.es_CL.json")],
        roomTopics: new Map(),
    });

    assert.equal(validate(contribution, rows).valid, true);
    // The guide's message keeps its values; the decision columns stay empty on it.
    assert.deepEqual(contribution.values, [{
        rowKey: 601,
        values: {
            polyadic_agent_name:                "ConversationGuide",
            polyadic_agent_trigger:             "unknown",
            polyadic_agent_in_reply_to:         null,
            polyadic_agent_visible_to_students: true,
        },
    }]);
    assert.equal(contribution.rows.length, 1);
    assert.equal(contribution.rows[0].values.polyadic_decision_intervention_message_id, 6001);
});

test("the room's topic names are given only while the listing is the version sent", async t => {
    const decisions = [storedDecision("no-intervention.es_CL.json")];

    const changed = await resolveRoomTopics(decisions, {
        getCaseAnalysis: async () => ({ ...LISTING_ROW, reviewed_at: new Date("2026-11-19T10:00:00Z") }),
    });
    assert.equal(changed.get(ROOM_JOB_ID).status, ROOM_TOPICS_STATUS.LISTING_CHANGED);
    assert.deepEqual(changed.get(ROOM_JOB_ID).topics, [
        { id: "T1", name: null }, { id: "T2", name: null }, { id: "T3", name: null },
    ]);

    const regenerated = await resolveRoomTopics(decisions, {
        getCaseAnalysis: async () => ({ ...LISTING_ROW, job_id: "00000000-0000-4000-8000-000000000000" }),
    });
    assert.equal(regenerated.get(ROOM_JOB_ID).status, ROOM_TOPICS_STATUS.LISTING_CHANGED);

    const gone = await resolveRoomTopics(decisions, { getCaseAnalysis: async () => null });
    assert.equal(gone.get(ROOM_JOB_ID).status, ROOM_TOPICS_STATUS.LISTING_UNAVAILABLE);

    silenceConsole(t);
    const failing = await resolveRoomTopics(decisions, {
        getCaseAnalysis: async () => {
            throw new Error("db down");
        },
    });
    assert.equal(failing.get(ROOM_JOB_ID).status, ROOM_TOPICS_STATUS.LISTING_UNAVAILABLE);

    // A room whose job recorded no topic list (created before #1221) has no
    // topics row; its decisions still name their topic.
    const unrecorded = await resolveRoomTopics([storedDecision("constructive.es_CL.json", {
        job: { ...ROOM_JOB, instantiationReport: null },
    })], { getCaseAnalysis: async () => assert.fail("nothing to read") });
    assert.equal(unrecorded.size, 0);
});

test("one listing read serves every room of the case", async () => {
    let reads = 0;
    const otherJob = { ...ROOM_JOB, id: "1d6f7a0e-2bd0-4672-b79d-d97027f9071b" };
    const rooms = await resolveRoomTopics([
        storedDecision("constructive.es_CL.json"),
        storedDecision("no-intervention.es_CL.json"),
        storedDecision("unparsed.en_US.json", { groupId: 302, job: otherJob }),
    ], { getCaseAnalysis: async () => {
        reads += 1;
        return LISTING_ROW;
    } });
    assert.equal(reads, 1);
    assert.deepEqual([...rooms.keys()], [ROOM_JOB_ID, otherJob.id]);
});
