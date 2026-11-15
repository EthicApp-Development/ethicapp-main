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
