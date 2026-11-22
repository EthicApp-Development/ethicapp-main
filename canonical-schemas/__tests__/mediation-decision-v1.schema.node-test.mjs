import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";

// Verbatim copy of ethicapp-ai-additions' schema (#1222, epic
// ethicapp-ai-additions#293); see canonical-schemas/ai-additions/README.md
// before changing these files.
const SCHEMA_URL = new URL("../ai-additions/mediation-decision.v1.schema.json", import.meta.url);
const EXAMPLES_URL = new URL(
    "../ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);

const EXPECTED_ID =
    "https://github.com/EthicApp-Development/ethicapp-ai-additions/schemas/mediation-decision/v1";
const EXPECTED_SCHEMA_VERSION = "mediation-decision/v1";

const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
const validator = new Validator(schema, "2020-12", false);

function readExamples() {
    return readdirSync(EXAMPLES_URL)
        .filter(name => name.endsWith(".json"))
        .sort()
        .map(name => ({
            name,
            record: JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8")),
        }));
}

function example(name) {
    return structuredClone(readExamples().find(entry => entry.name === name).record);
}

function describeErrors(result) {
    return result.errors
        .filter(error => !/subschema|does not match schema|Items did not match/u.test(error.error))
        .map(error => `${error.instanceLocation}: ${error.error}`)
        .join("\n");
}

function assertValid(record, label) {
    const result = validator.validate(record);
    assert.equal(result.valid, true, `${label} should be valid:\n${describeErrors(result)}`);
}

function assertInvalid(record, label) {
    assert.equal(validator.validate(record).valid, false, `${label} should be invalid`);
}

// ─── The copy ────────────────────────────────────────────────────────────────

test("the copy is the draft 2020-12 mediation-decision/v1 schema", () => {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.$id, EXPECTED_ID);
    assert.deepEqual(schema.properties.schemaVersion, { const: EXPECTED_SCHEMA_VERSION });
    assert.equal(schema.additionalProperties, false);
});

test("every example validates, with each decision among them", () => {
    const examples = readExamples();
    assert.ok(examples.length > 0, "the examples folder has records");

    for (const { name, record } of examples) {
        assertValid(record, name);
        assert.equal(record.schemaVersion, EXPECTED_SCHEMA_VERSION, `${name} schemaVersion`);
    }
    const decisions = new Set(examples.map(({ record }) => record.decision));
    assert.deepEqual([...decisions].sort(), ["intervene", "no_intervention", "unparsed"]);
    const statuses = new Set(examples.map(({ record }) => record.intervention.status));
    assert.deepEqual([...statuses].sort(), ["intervened", "not_requested", "suppressed"]);
});

test("decision ids are unique across the examples", () => {
    const ids = readExamples().map(({ record }) => record.decisionId);
    assert.equal(new Set(ids).size, ids.length);
});

test("the examples follow the integrity rules the schema cannot express", () => {
    for (const { name, record } of readExamples()) {
        const { decision, category, topic, intervention } = record;
        if (decision === "intervene") {
            assert.notEqual(intervention.status, "not_requested", `${name} status`);
            assert.notEqual(intervention.agent, null, `${name} agent`);
        } else {
            assert.equal(category, null, `${name} category`);
            assert.equal(topic, null, `${name} topic`);
            assert.equal(intervention.status, "not_requested", `${name} status`);
            assert.equal(intervention.agent, null, `${name} agent`);
        }
        assert.equal(intervention.messageId !== null, intervention.status === "intervened",
            `${name} messageId`);
        assert.equal(intervention.suppressedBy !== null, intervention.status === "suppressed",
            `${name} suppressedBy`);
    }
});

// ─── What the copy rejects ───────────────────────────────────────────────────

test("an undefined key, at the top or inside a part, is rejected", () => {
    assertInvalid({ ...example("constructive.es_CL.json"), extra: true }, "top-level key");

    const nested = example("constructive.es_CL.json");
    nested.window.messages[0].text = "what a participant wrote";
    assertInvalid(nested, "message text in the window");

    const intervention = example("constructive.es_CL.json");
    intervention.intervention.note = "x";
    assertInvalid(intervention, "intervention key");
});

test("a missing required key is rejected", () => {
    for (const key of schema.required) {
        const record = example("no-intervention.es_CL.json");
        delete record[key];
        assertInvalid(record, `without ${key}`);
    }
});

test("ids, labels and enums outside their patterns are rejected", () => {
    const cases = [
        ["decisionId not a UUID", record => { record.decisionId = "decision-1"; }],
        ["unknown decision", record => { record.decision = "maybe"; }],
        ["lower-case category", record => { record.category = "constructive"; }],
        ["topic id outside T#", record => { record.topic.id = "topic-2"; }],
        ["blank topic name", record => { record.topic.name = "   "; }],
        ["unknown intervention status", record => { record.intervention.status = "skipped"; }],
        ["message id zero", record => { record.window.messages[0].messageId = 0; }],
        ["message id as string", record => { record.window.messages[0].messageId = "101"; }],
        ["trigger kind with capitals", record => { record.trigger.kind = "Adaptive"; }],
        ["other schemaVersion", record => { record.schemaVersion = "mediation-decision/v2"; }],
        ["over-long reason", record => { record.reason = "x".repeat(4001); }],
    ];
    for (const [label, change] of cases) {
        const record = example("constructive.es_CL.json");
        change(record);
        assertInvalid(record, label);
    }
});

test("nullable parts accept null and their own shape only", () => {
    const record = example("unparsed.en_US.json");
    record.trigger.reason = null;
    assertValid(record, "trigger without reason");

    const withNumberTopic = example("unparsed.en_US.json");
    withNumberTopic.topic = 2;
    assertInvalid(withNumberTopic, "topic as a number");
});

// ─── The topic coverage (#1233, ethicapp-ai-additions#313) ──────────────────

const COVERAGE_EXAMPLE = "topic-coverage.es_CL.json";

function pendingTopics(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `T${index + 1}`, status: "pending", evidence: [],
    }));
}

test("the coverage is optional and closed, with its own topic id pattern", () => {
    assert.equal(schema.required.includes("topicCoverage"), false);
    const coverage = schema.properties.topicCoverage;
    assert.equal(coverage.additionalProperties, false);
    assert.deepEqual(coverage.required, ["status", "updatedTopicIds", "topics"]);
    assert.deepEqual(coverage.properties.status.enum, ["updated", "unchanged", "failed"]);
    assert.deepEqual(schema.$defs.topicProgress.properties.status.enum, ["pending", "partial", "developed"]);
    assert.equal(schema.$defs.topicProgress.additionalProperties, false);
    assert.equal(schema.$defs.topicId.pattern, schema.$defs.topic.properties.id.pattern);
});

test("only the coverage example carries a coverage, with every level and evidence old and new", () => {
    const examples = readExamples();
    assert.deepEqual(examples.filter(({ record }) => "topicCoverage" in record).map(({ name }) => name),
        [COVERAGE_EXAMPLE]);
    const record = example(COVERAGE_EXAMPLE);
    const { topics, updatedTopicIds, status } = record.topicCoverage;
    assert.deepEqual([...new Set(topics.map(topic => topic.status))].sort(), ["developed", "partial", "pending"]);
    const windowIds = new Set(record.window.messages.map(reference => reference.messageId));
    const evidenceIds = topics.flatMap(topic => topic.evidence.map(reference => reference.messageId));
    assert.ok(evidenceIds.some(id => windowIds.has(id)), "evidence from this window");
    assert.ok(evidenceIds.some(id => !windowIds.has(id)), "evidence from earlier windows");
    assert.equal(status, "updated");
    assert.ok(updatedTopicIds.length > 0);
});

test("the coverage example follows the coverage's integrity rules", () => {
    const { topic, topicCoverage } = example(COVERAGE_EXAMPLE);
    const statuses = new Map(topicCoverage.topics.map(progress => [progress.id, progress.status]));
    assert.equal(statuses.size, topicCoverage.topics.length, "each topic once");
    for (const progress of topicCoverage.topics) {
        assert.equal(progress.evidence.length > 0, progress.status !== "pending", progress.id);
        const ids = progress.evidence.map(reference => reference.messageId);
        assert.equal(new Set(ids).size, ids.length, `${progress.id} cites each message once`);
    }
    for (const id of topicCoverage.updatedTopicIds) {
        assert.ok(statuses.has(id) && statuses.get(id) !== "pending", id);
    }
    assert.ok(statuses.has(topic.id), "the decision's topic is in the coverage");
});

test("every other example accepts a coverage", () => {
    for (const { name, record } of readExamples()) {
        if (name === COVERAGE_EXAMPLE) {
            continue;
        }
        assertValid({
            ...record,
            topicCoverage: { status: "unchanged", updatedTopicIds: [], topics: pendingTopics(4) },
        }, name);
    }
});

test("the coverage's bounds and patterns are enforced", () => {
    const withTopics = count => {
        const record = example(COVERAGE_EXAMPLE);
        record.topic = null;
        record.topicCoverage = { status: "unchanged", updatedTopicIds: [], topics: pendingTopics(count) };
        return record;
    };
    assertValid(withTopics(20), "20 topics");
    assertInvalid(withTopics(21), "21 topics");
    assertInvalid(withTopics(0), "no topics");

    const evidence = count => {
        const record = example(COVERAGE_EXAMPLE);
        record.topicCoverage.topics[0].evidence = Array.from({ length: count }, (_, index) => ({
            messageId: index + 1, correlationId: null,
        }));
        return record;
    };
    assertValid(evidence(20), "20 evidence messages");
    assertInvalid(evidence(21), "21 evidence messages");

    const cases = [
        ["topic id outside T#", record => { record.topicCoverage.topics[0].id = "topic-1"; }],
        ["updated id outside T#", record => { record.topicCoverage.updatedTopicIds = ["T0"]; }],
        ["unknown run status", record => { record.topicCoverage.status = "partial"; }],
        ["unknown topic level", record => { record.topicCoverage.topics[0].status = "covered"; }],
        ["a topic's title", record => { record.topicCoverage.topics[0].name = "Veracidad"; }],
        ["evidence text", record => { record.topicCoverage.topics[0].evidence[0].text = "x"; }],
        ["an undefined coverage key", record => { record.topicCoverage.summary = "x"; }],
        ["a null coverage", record => { record.topicCoverage = null; }],
        ["without updatedTopicIds", record => { delete record.topicCoverage.updatedTopicIds; }],
        ["21 updated topics", record => {
            record.topicCoverage.updatedTopicIds = pendingTopics(21).map(topic => topic.id);
        }],
    ];
    for (const [label, change] of cases) {
        const record = example(COVERAGE_EXAMPLE);
        change(record);
        assertInvalid(record, label);
    }
});
