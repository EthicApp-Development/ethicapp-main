// mediation-decision/v1 records (#1222): validation against EthicApp's copy
// of the schema and the integrity rules of ethicapp_ai_capabilities, the
// topic coverage's included (#1233).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
    createMediationDecisionValidator,
    loggableDecisionId,
    MEDIATION_DECISION_PROBLEM_CODES,
    mediationDecisionIntegrityProblems,
    validateMediationDecision,
} from "../mediation-decision-records.js";

const EXAMPLES_URL = new URL(
    "../../../../canonical-schemas/ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);

function example(name) {
    return JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
}

function codes(result) {
    return result.problems.map(({ code, path }) => `${code} ${path}`);
}

test("every example of the copy is valid", () => {
    const names = readdirSync(EXAMPLES_URL).filter(name => name.endsWith(".json"));
    assert.equal(names.length, 5);
    for (const name of names) {
        assert.deepEqual(validateMediationDecision(example(name)), { valid: true, problems: [] }, name);
    }
});

test("a schema violation names its path and keyword, never a value", () => {
    const record = example("constructive.es_CL.json");
    record.window.messages[0].text = "Ana: firmar está mal";
    record.decidedAt = "yesterday";

    const result = validateMediationDecision(record);

    assert.equal(result.valid, false);
    assert.ok(result.problems.every(problem => problem.code === MEDIATION_DECISION_PROBLEM_CODES.SCHEMA_VIOLATION));
    const paths = result.problems.map(problem => problem.path);
    assert.ok(paths.includes("window.messages[0].text"), paths.join());
    assert.ok(paths.includes("decidedAt"), paths.join());
    assert.equal(JSON.stringify(result).includes("Ana"), false);
    assert.equal(JSON.stringify(result).includes("yesterday"), false);
});

test("only an intervention has a category, a topic and an asked agent", () => {
    const noIntervention = example("no-intervention.es_CL.json");
    noIntervention.category = "STUCK";
    noIntervention.topic = { id: "T1", name: "Lealtad" };
    noIntervention.intervention = {
        status: "suppressed", agent: "ConversationGuide", messageId: null, suppressedBy: "cooldown",
    };
    assert.deepEqual(codes(validateMediationDecision(noIntervention)), [
        "decision_mismatch category",
        "decision_mismatch topic",
        "decision_mismatch intervention.status",
    ]);

    const intervene = example("constructive.es_CL.json");
    intervene.intervention = { status: "not_requested", agent: null, messageId: null, suppressedBy: null };
    assert.deepEqual(codes(validateMediationDecision(intervene)), [
        "decision_mismatch intervention.status",
    ]);
});

test("each intervention status carries exactly its own details", () => {
    const record = example("stuck-suppressed.es_CL.json");
    record.intervention.messageId = 120;
    record.intervention.suppressedBy = null;
    assert.deepEqual(codes(validateMediationDecision(record)), [
        "intervention_mismatch intervention.messageId",
        "intervention_mismatch intervention.suppressedBy",
    ]);

    const failed = example("constructive.es_CL.json");
    failed.intervention = { status: "failed", agent: null, messageId: null, suppressedBy: null };
    assert.deepEqual(codes(validateMediationDecision(failed)), [
        "intervention_mismatch intervention.agent",
    ]);
});

test("a message evaluated twice in one window is refused", () => {
    const record = example("constructive.es_CL.json");
    record.window.messages.push({ ...record.window.messages[0] });
    assert.deepEqual(codes(validateMediationDecision(record)), [
        "duplicate_message_ref window.messages[4].messageId",
    ]);
});

// ─── The topic coverage (#1233, ethicapp-ai-additions#313) ──────────────────

const COVERAGE_EXAMPLE = "topic-coverage.es_CL.json";

function ref(messageId) {
    return { messageId, correlationId: null };
}

test("a record without coverage is unaffected, and every example accepts one", () => {
    const names = readdirSync(EXAMPLES_URL).filter(name => name.endsWith(".json") && name !== COVERAGE_EXAMPLE);
    for (const name of names) {
        const record = example(name);
        assert.equal(Object.hasOwn(record, "topicCoverage"), false, name);
        record.topicCoverage = {
            status:          "unchanged",
            updatedTopicIds: [],
            topics:          ["T1", "T2", "T3", "T4"].map(id => ({ id, status: "pending", evidence: [] })),
        };
        assert.deepEqual(validateMediationDecision(record), { valid: true, problems: [] }, name);
    }
});

test("a coverage key the copy does not define is refused", () => {
    const record = example(COVERAGE_EXAMPLE);
    record.topicCoverage.topics[0].title = "Veracidad del registro";
    const result = validateMediationDecision(record);
    assert.equal(result.valid, false);
    assert.ok(codes(result).includes("schema_violation topicCoverage.topics[0].title"), codes(result).join());
    assert.equal(JSON.stringify(result).includes("Veracidad"), false);
});

test("each topic appears once in the coverage and in its updated topics", () => {
    const duplicate = example(COVERAGE_EXAMPLE);
    duplicate.topicCoverage.topics.push({ id: "T4", status: "pending", evidence: [] });
    assert.deepEqual(codes(validateMediationDecision(duplicate)), [
        "duplicate_topic_id topicCoverage.topics[4].id",
    ]);

    const updatedTwice = example(COVERAGE_EXAMPLE);
    updatedTwice.topicCoverage.updatedTopicIds = ["T2", "T2"];
    assert.deepEqual(codes(validateMediationDecision(updatedTwice)), [
        "duplicate_topic_id topicCoverage.updatedTopicIds[1]",
    ]);
});

test("the updated topics are raised topics of the snapshot, named only by an updated run", () => {
    const unknown = example(COVERAGE_EXAMPLE);
    unknown.topicCoverage.updatedTopicIds = ["T2", "T9"];
    assert.deepEqual(codes(validateMediationDecision(unknown)), [
        "unknown_topic_id topicCoverage.updatedTopicIds[1]",
    ]);

    const pending = example(COVERAGE_EXAMPLE);
    pending.topicCoverage.updatedTopicIds = ["T4"];
    assert.deepEqual(codes(validateMediationDecision(pending)), [
        "coverage_mismatch topicCoverage.updatedTopicIds[0]",
    ]);

    for (const status of ["unchanged", "failed"]) {
        const record = example(COVERAGE_EXAMPLE);
        record.topicCoverage.status = status;
        assert.deepEqual(codes(validateMediationDecision(record)), [
            "coverage_mismatch topicCoverage.updatedTopicIds",
        ], status);
        record.topicCoverage.updatedTopicIds = [];
        assert.deepEqual(validateMediationDecision(record), { valid: true, problems: [] }, status);
    }

    const empty = example(COVERAGE_EXAMPLE);
    empty.topicCoverage.updatedTopicIds = [];
    assert.deepEqual(codes(validateMediationDecision(empty)), [
        "coverage_mismatch topicCoverage.updatedTopicIds",
    ]);
});

test("a topic's evidence matches its level and cites each message once", () => {
    const pending = example(COVERAGE_EXAMPLE);
    pending.topicCoverage.topics[2].evidence = [ref(121)];
    assert.deepEqual(codes(validateMediationDecision(pending)), [
        "coverage_mismatch topicCoverage.topics[2].evidence",
    ]);

    for (const status of ["partial", "developed"]) {
        const record = example(COVERAGE_EXAMPLE);
        record.topicCoverage.topics[0].status = status;
        record.topicCoverage.topics[0].evidence = [];
        assert.deepEqual(codes(validateMediationDecision(record)), [
            "coverage_mismatch topicCoverage.topics[0].evidence",
        ], status);
    }

    const twice = example(COVERAGE_EXAMPLE);
    twice.topicCoverage.topics[0].evidence.push({ ...twice.topicCoverage.topics[0].evidence[1] });
    assert.deepEqual(codes(validateMediationDecision(twice)), [
        "duplicate_message_ref topicCoverage.topics[0].evidence[3].messageId",
    ]);

    // A message may support several topics, and evidence may come from
    // earlier windows only.
    const shared = example(COVERAGE_EXAMPLE);
    shared.topicCoverage.topics[0].evidence.push(ref(122));
    shared.topicCoverage.status = "unchanged";
    shared.topicCoverage.updatedTopicIds = [];
    shared.window.messages = [];
    assert.deepEqual(validateMediationDecision(shared), { valid: true, problems: [] });
});

test("the decision's topic is a topic of the coverage", () => {
    const record = example(COVERAGE_EXAMPLE);
    record.topic = { id: "T7", name: "Un tópico de otra sala" };
    assert.deepEqual(codes(validateMediationDecision(record)), ["unknown_topic_id topic.id"]);
});

test("malformed coverages are reported, never thrown", () => {
    const records = [
        { topicCoverage: "x" },
        { topicCoverage: { status: "updated", updatedTopicIds: "T1", topics: { T1: "pending" } } },
        { topicCoverage: { status: 3, updatedTopicIds: [null, 1, "T1"], topics: [null, "T1", { id: 1 }] } },
        { topic: { id: "T1" }, topicCoverage: { topics: [{ id: "T2", status: "partial", evidence: "x" }] } },
        { topicCoverage: { topics: [{ id: "T1", status: "pending", evidence: [null, { messageId: true }] }] } },
    ];
    for (const record of records) {
        const result = validateMediationDecision(record);
        assert.equal(result.valid, false, JSON.stringify(record));
        assert.doesNotThrow(() => mediationDecisionIntegrityProblems(record));
    }
    assert.deepEqual(mediationDecisionIntegrityProblems({
        topicCoverage: { status: 3, updatedTopicIds: [null, 1, "T1"], topics: [null, "T1", { id: 1 }] },
    }), [{ code: "unknown_topic_id", path: "topicCoverage.updatedTopicIds[2]" }]);
});

test("integrity rules ignore values the schema already refuses", () => {
    assert.deepEqual(mediationDecisionIntegrityProblems(null), []);
    assert.deepEqual(mediationDecisionIntegrityProblems({ decision: "maybe", intervention: {} }), []);
    assert.deepEqual(mediationDecisionIntegrityProblems({ window: { messages: [{ messageId: "1" }, { messageId: "1" }] } }), []);
});

test("a value with no JSON form, and an unreadable copy, are refused", () => {
    const cyclic = example("no-intervention.es_CL.json");
    cyclic.self = cyclic;
    assert.deepEqual(validateMediationDecision(cyclic).problems, [
        { code: "schema_violation", keyword: "not_json", path: "<root>" },
    ]);

    const errors = [];
    const validate = createMediationDecisionValidator({
        readSchema: () => {
            throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
        },
        logger: { error: (...args) => errors.push(args) },
    });
    assert.deepEqual(validate(example("no-intervention.es_CL.json")), {
        valid:    false,
        problems: [{ code: "schema_unavailable", path: "<root>" }],
    });
    validate(example("no-intervention.es_CL.json"));
    assert.equal(errors.length, 1, "logged once");
});

test("loggableDecisionId gives the UUID only", () => {
    assert.equal(loggableDecisionId(example("unparsed.en_US.json")), "0b9e8a52-7a1f-4f7e-9d43-5c1e2f3a4b04");
    assert.equal(loggableDecisionId({ decisionId: "Ana wrote this" }), null);
    assert.equal(loggableDecisionId({ decisionId: 12 }), null);
    assert.equal(loggableDecisionId(null), null);
});
