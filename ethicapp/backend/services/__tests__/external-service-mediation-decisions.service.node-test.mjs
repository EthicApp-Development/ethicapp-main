// Stored mediation decisions (#1222, V46, and their topic coverage, #1233,
// V47): the store adapters write through, and the report reader that reads
// them back.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    createMediationDecisionsAccess,
    ExternalServiceMediationDecisionsService,
} from "../external-service-mediation-decisions.service.js";
import { createReportResultsReader } from "../external-service-report-results.service.js";

const SERVICE_ID = "polyadic-devils-advocate";
const EXAMPLES_URL = new URL(
    "../../../../canonical-schemas/ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);

function example(name) {
    return JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
}

function fakeDb({ jobs = [], existing = new Set() } = {}) {
    const calls = [];
    async function db(sql, params) {
        const text = sql.replace(/\s+/g, " ").trim();
        calls.push({ sql: text, params });
        if (text.startsWith("SELECT id::text AS correlation_id")) {
            return jobs;
        }
        if (text.startsWith("INSERT INTO external_service_mediation_decisions")) {
            const key = `${params[0]}|${params[1]}`;
            if (existing.has(key)) {
                return [];
            }
            existing.add(key);
            return [{ id: String(existing.size) }];
        }
        return [];
    }
    return { db, calls };
}

test("stores each record once with its room, job, result and resolved messages", async () => {
    const record = example("constructive.es_CL.json");
    // An upper-case reference still resolves; an id of another form does not.
    record.window.messages[1].correlationId = record.window.messages[1].correlationId.toUpperCase();
    record.window.messages[2].correlationId = "not-a-uuid";
    const { db, calls } = fakeDb({
        jobs: [
            { correlation_id: "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0101", source_id: "5001" },
            { correlation_id: "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0102", source_id: 5002 },
        ],
    });
    const store = new ExternalServiceMediationDecisionsService({ dbQuery: db });
    const access = createMediationDecisionsAccess(store, SERVICE_ID);

    const outcome = await access.record({
        sessionId:  11,
        phaseId:    22,
        questionId: 701,
        groupId:    301,
        jobId:      "8a6e0804-2bd0-4672-b79d-d97027f9071a",
        resultId:   "0f8fad5b-d9cb-469f-a165-70867728950e",
        decisions:  [{ record, interventionChatMessageId: 6001 }],
    });

    assert.deepEqual(outcome, { stored: [record.decisionId], duplicates: [] });

    const lookup = calls[0];
    assert.match(lookup.sql, /FROM external_service_jobs WHERE service_id = \$1 AND session_id = \$2 AND source_kind = \$3 AND id = ANY\(\$4::uuid\[\]\)/);
    assert.deepEqual(lookup.params, [SERVICE_ID, 11, "chat_message", [
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0101",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0102",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0105",
    ]]);

    const insert = calls[1];
    assert.match(insert.sql, /ON CONFLICT \(service_id, decision_id\) DO NOTHING/);
    assert.deepEqual(insert.params, [
        SERVICE_ID, record.decisionId, 11, 22, 701, 301,
        "8a6e0804-2bd0-4672-b79d-d97027f9071a", "0f8fad5b-d9cb-469f-a165-70867728950e",
        record.decidedAt, JSON.stringify(record),
        [5001, 5002, null, null],
        6001,
        // A record without coverage stores no coverage evidence.
        null,
    ]);
    assert.match(insert.sql, /coverage_evidence_chat_message_ids\) VALUES/);
});

test("a coverage's evidence resolves with the window's, also from earlier windows", async () => {
    const record = example("topic-coverage.es_CL.json");
    // T1's evidence comes from earlier windows; 109 has no job, and T2's 125
    // has no correlation id.
    record.topicCoverage.topics[1].evidence[1].correlationId = null;
    const { db, calls } = fakeDb({
        jobs: [
            { correlation_id: "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0101", source_id: "5101" },
            { correlation_id: "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0104", source_id: "5104" },
            { correlation_id: "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0121", source_id: "5121" },
            { correlation_id: "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0122", source_id: "5122" },
        ],
    });
    const store = new ExternalServiceMediationDecisionsService({ dbQuery: db });

    await store.recordDecisions({
        serviceId: SERVICE_ID, sessionId: 11, phaseId: 22, groupId: 301,
        decisions: [{ record }],
    });

    // One lookup for the window and the evidence, each id once.
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params[3], [
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0121",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0122",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0124",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0125",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0101",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0104",
        "6f1c2a4e-0b7d-4c55-9a0e-3d2b1c0a0109",
    ]);
    const params = calls[1].params;
    // The record is stored verbatim, its coverage included.
    assert.equal(params[9], JSON.stringify(record));
    assert.deepEqual(params[10], [5121, 5122, null, null]);
    assert.equal(params[12], JSON.stringify([[5101, 5104, null], [5122, null], [], []]));
});

test("a callback delivered twice stores its decisions once", async () => {
    const existing = new Set();
    const store = new ExternalServiceMediationDecisionsService({ dbQuery: fakeDb({ existing }).db });
    const decisions = [
        { record: example("no-intervention.es_CL.json") },
        { record: example("unparsed.en_US.json") },
    ];
    const args = { serviceId: SERVICE_ID, sessionId: 11, phaseId: 22, groupId: 301, decisions };

    const first = await store.recordDecisions(args);
    const second = await store.recordDecisions(args);

    assert.deepEqual(first.stored, decisions.map(({ record }) => record.decisionId));
    assert.deepEqual(second, { stored: [], duplicates: first.stored });
    assert.equal(existing.size, 2);
});

test("nothing to store reads and writes nothing", async () => {
    const { db, calls } = fakeDb();
    const store = new ExternalServiceMediationDecisionsService({ dbQuery: db });
    assert.deepEqual(await store.recordDecisions({ serviceId: SERVICE_ID, sessionId: 1, phaseId: 2, decisions: [] }),
        { stored: [], duplicates: [] });
    assert.equal(calls.length, 0);
});

test("the access is bound to its service", async () => {
    const seen = [];
    const access = createMediationDecisionsAccess({ recordDecisions: async args => seen.push(args) }, SERVICE_ID);
    await access.record({ serviceId: "another-service", sessionId: 1, phaseId: 2, decisions: [] });
    assert.equal(seen[0].serviceId, SERVICE_ID);
});

// ─── The report reader ──────────────────────────────────────────────────────

function decisionRow(overrides = {}) {
    const record = example("constructive.es_CL.json");
    return {
        id:                           "7",
        service_id:                   SERVICE_ID,
        session_id:                   11,
        decision_id:                  record.decisionId,
        phase_id:                     22,
        question_id:                  701,
        group_id:                     301,
        result_id:                    "0f8fad5b-d9cb-469f-a165-70867728950e",
        record,
        window_chat_message_ids:      ["5001", "5002", null, "5005"],
        intervention_chat_message_id: "6001",
        decided_at:                   new Date("2026-11-18T17:05:12.000Z"),
        received_at:                  new Date("2026-11-18T17:05:13.000Z"),
        job_id:                       "8a6e0804-2bd0-4672-b79d-d97027f9071a",
        job_kind:                     "room",
        job_created_at:               new Date("2026-11-18T17:00:00.000Z"),
        job_instantiation_report:     { caseInputs: [{ key: "discussion_topics", ids: ["T1"] }] },
        ...overrides,
    };
}

test("the reader returns the service's decisions of the session with their room job", async () => {
    const asked = [];
    const store = {
        listMediationDecisions: async args => {
            asked.push(args);
            return [
                decisionRow(),
                decisionRow({ id: "8", session_id: 12 }),
                decisionRow({ id: "9", service_id: "another-service" }),
                decisionRow({ id: "10", job_id: null, intervention_chat_message_id: null }),
            ];
        },
    };
    const reader = createReportResultsReader(store, { serviceId: SERVICE_ID, sessionId: 11 });

    const decisions = await reader.mediationDecisions();

    assert.deepEqual(asked, [{ serviceId: SERVICE_ID, sessionId: 11 }]);
    assert.deepEqual(decisions.map(decision => decision.id), ["7", "10"]);
    assert.deepEqual(decisions[0], {
        id:                        "7",
        decisionId:                "0b9e8a52-7a1f-4f7e-9d43-5c1e2f3a4b01",
        phaseId:                   22,
        questionId:                701,
        groupId:                   301,
        resultId:                  "0f8fad5b-d9cb-469f-a165-70867728950e",
        record:                    example("constructive.es_CL.json"),
        windowChatMessageIds:           [5001, 5002, null, 5005],
        interventionChatMessageId:      6001,
        coverageEvidenceChatMessageIds: null,
        decidedAt:                      "2026-11-18T17:05:12.000Z",
        receivedAt:                     "2026-11-18T17:05:13.000Z",
        job:                            {
            id:                  "8a6e0804-2bd0-4672-b79d-d97027f9071a",
            kind:                "room",
            createdAt:           "2026-11-18T17:00:00.000Z",
            instantiationReport: { caseInputs: [{ key: "discussion_topics", ids: ["T1"] }] },
        },
    });
    assert.equal(decisions[1].job, null);
    assert.equal(decisions[1].interventionChatMessageId, null);
    assert.ok(Object.isFrozen(decisions[0]));
});

test("the reader gives a coverage's evidence as chat message ids, aligned with its topics", async () => {
    const record = example("topic-coverage.es_CL.json");
    const store = {
        listMediationDecisions: async () => [decisionRow({
            decision_id:                        record.decisionId,
            record,
            coverage_evidence_chat_message_ids: [["5101", 5104, null], ["5122", "x"], [], "?"],
        })],
    };
    const reader = createReportResultsReader(store, { serviceId: SERVICE_ID, sessionId: 11 });

    const [decision] = await reader.mediationDecisions();

    assert.deepEqual(decision.coverageEvidenceChatMessageIds, [[5101, 5104, null], [5122, null], [], []]);
    assert.ok(Object.isFrozen(decision.coverageEvidenceChatMessageIds));
    assert.ok(Object.isFrozen(decision.coverageEvidenceChatMessageIds[0]));
});

test("a store that keeps no decisions gives none", async () => {
    const reader = createReportResultsReader({ listResults: async () => [] }, { serviceId: SERVICE_ID, sessionId: 11 });
    assert.deepEqual(await reader.mediationDecisions(), []);
});
