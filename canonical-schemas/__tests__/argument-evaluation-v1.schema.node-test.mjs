import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";

// Verbatim copy of ethicapp-ai-additions' schema (#1214); see
// canonical-schemas/ai-additions/README.md before changing these files.
const SCHEMA_URL = new URL("../ai-additions/argument-evaluation.v1.schema.json", import.meta.url);
const EXAMPLES_URL = new URL(
    "../ai-additions/examples/argument-evaluation.v1/",
    import.meta.url
);

const EXPECTED_ID =
    "https://github.com/EthicApp-Development/ethicapp-ai-additions/schemas/argument-evaluation/v1";
const EXPECTED_SCHEMA_VERSION = "argument-evaluation/v1";

const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
const validator = new Validator(schema, "2020-12", false);

function readExamples() {
    return readdirSync(EXAMPLES_URL)
        .filter(name => name.endsWith(".json"))
        .sort()
        .map(name => ({
            name,
            document: JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8")),
        }));
}

function example(name) {
    return structuredClone(readExamples().find(entry => entry.name === name).document);
}

function describeErrors(result) {
    return result.errors
        .filter(error => !/subschema|does not match schema|Items did not match/u.test(error.error))
        .map(error => `${error.instanceLocation}: ${error.error}`)
        .join("\n");
}

function assertValid(document, label) {
    const result = validator.validate(document);
    assert.equal(result.valid, true, `${label} should be valid:\n${describeErrors(result)}`);
}

function assertInvalid(document, label) {
    assert.equal(validator.validate(document).valid, false, `${label} should be invalid`);
}

// ─── The copy ────────────────────────────────────────────────────────────────

test("the copy is the draft 2020-12 argument-evaluation/v1 schema", () => {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.$id, EXPECTED_ID);
    assert.deepEqual(schema.properties.schemaVersion, { const: EXPECTED_SCHEMA_VERSION });
});

test("every example validates, with an analysis and a comparison among them", () => {
    const examples = readExamples();
    assert.ok(examples.length > 0, "the examples folder has documents");

    for (const { name, document } of examples) {
        assertValid(document, name);
        assert.equal(document.schemaVersion, EXPECTED_SCHEMA_VERSION, `${name} schemaVersion`);
    }
    const kinds = new Set(examples.map(({ document }) => document.kind));
    assert.deepEqual([...kinds].sort(), ["analysis", "comparison"]);
});

test("every level of the examples carries its scale", () => {
    for (const { name, document } of readExamples()) {
        const evaluations = document.kind === "analysis"
            ? [document.evaluation]
            : [document.initial, document.revised];
        for (const evaluation of evaluations) {
            for (const [key, criterion] of Object.entries(evaluation.criteria)) {
                const { level, scale } = criterion;
                assert.ok(Number.isInteger(level), `${name} ${key} level`);
                assert.ok(scale.min <= level && level <= scale.max, `${name} ${key} within scale`);
            }
        }
    }
});

// ─── Documents the contract refuses ──────────────────────────────────────────

test("an analysis without its evaluation, or with comparison keys, is invalid", () => {
    const analysis = example("analysis-enhanced.es_CL.json");
    const withoutEvaluation = structuredClone(analysis);
    delete withoutEvaluation.evaluation;
    assertInvalid(withoutEvaluation, "analysis without evaluation");
    assertInvalid({ ...analysis, initial: analysis.evaluation }, "analysis with initial");
});

test("a comparison without its differences, or with an evaluation, is invalid", () => {
    const comparison = example("comparison.es_CL.json");
    const withoutDifferences = structuredClone(comparison);
    delete withoutDifferences.differences;
    assertInvalid(withoutDifferences, "comparison without differences");
    assertInvalid({ ...comparison, evaluation: comparison.revised }, "comparison with evaluation");
});

test("levels outside the rubric's scales are invalid", () => {
    const outOfScale = example("analysis-enhanced.es_CL.json");
    outOfScale.evaluation.criteria.qualifier.level = 2;
    assertInvalid(outOfScale, "qualifier level 2");

    const otherScale = example("analysis-enhanced.es_CL.json");
    otherScale.evaluation.criteria.evidence.scale = { min: 1, max: 3 };
    assertInvalid(otherScale, "evidence on the v12 scale");
});

test("ids outside their patterns and keys the schema does not define are invalid", () => {
    const badClaimType = example("analysis-enhanced.es_CL.json");
    badClaimType.evaluation.criteria.claim.claimTypeId = "EV2";
    assertInvalid(badClaimType, "claim type that is a fact id");

    const badFact = example("analysis-enhanced.es_CL.json");
    badFact.evaluation.criteria.evidence.factIds = ["EX3"];
    assertInvalid(badFact, "fact that is an exclusion id");

    assertInvalid({ ...example("analysis-no-claim.es_CL.json"), claim: 2 },
        "a legacy score key at the top level");
    assertInvalid({ ...example("analysis-no-claim.es_CL.json"), tutorMode: "basic" },
        "the basic mode, which v1 does not describe");
});
