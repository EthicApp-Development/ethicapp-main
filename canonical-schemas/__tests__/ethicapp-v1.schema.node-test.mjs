import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Validator } from "@cfworker/json-schema";

const SCHEMA_URL = new URL("../ethicapp-v1.schema.json", import.meta.url);
const SEED_MANIFEST_URL = new URL(
    "../../database/seeds/canonical-activities/manifest.json",
    import.meta.url
);

const schema = JSON.parse(readFileSync(SCHEMA_URL, "utf8"));
const validator = new Validator(schema, "2020-12", false);

function readSeedDesigns() {
    const manifest = JSON.parse(readFileSync(SEED_MANIFEST_URL, "utf8"));
    return manifest.activities.map(activity => ({ key: activity.key, design: activity.design }));
}

// Leaf errors only: oneOf/allOf wrappers repeat them without detail.
function describeErrors(result) {
    return result.errors
        .filter(error => !/subschema|does not match schema|Items did not match/u.test(error.error))
        .map(error => `${error.instanceLocation}: ${error.error}`)
        .join("\n");
}

function assertValid(design, label = "design") {
    const result = validator.validate(design);
    assert.equal(result.valid, true, `${label} should be valid:\n${describeErrors(result)}`);
}

function assertInvalid(design, label = "design") {
    assert.equal(validator.validate(design).valid, false, `${label} should be invalid`);
}

function seedPhase(overrides = {}) {
    return { ...structuredClone(readSeedDesigns()[0].design.phases[0]), ...overrides };
}

function designWithPhase(phase) {
    const [seed] = readSeedDesigns();
    return { ...structuredClone(seed.design), phases: [phase] };
}

function designWithConfigurations(configurations) {
    return designWithPhase({
        ...structuredClone(readSeedDesigns()[0].design.phases[0]),
        externalServices: {
            enabledServiceIds: ["polyadic-devils-advocate"],
            configurations,
        },
    });
}

// ─── Seeds ────────────────────────────────────────────────────────────────────

test("every canonical seed design validates", () => {
    const seeds = readSeedDesigns();
    assert.ok(seeds.length > 0, "the seed manifest has designs");

    for (const { key, design } of seeds) {
        assertValid(design, key);
    }
});

// ─── externalServices.configurations (#729) ──────────────────────────────────

test("designs without externalServices or without configurations stay valid", () => {
    const phase = structuredClone(readSeedDesigns()[0].design.phases[0]);

    const withoutExternalServices = { ...phase };
    delete withoutExternalServices.externalServices;
    assertValid(designWithPhase(withoutExternalServices), "no externalServices");
    assertValid(designWithPhase({ ...phase, externalServices: { enabledServiceIds: [] } }),
        "enabledServiceIds only");
    assertValid(designWithPhase({ ...phase, externalServices: {} }), "empty externalServices");
});

test("configurations accept scalar values keyed by field", () => {
    assertValid(designWithConfigurations({
        "polyadic-devils-advocate": {
            pipeline_type:            "devilsAdvocate",
            llm_tier:                 "basic",
            session_duration_seconds: 600,
            anonymous_guide:          false,
            agent_nickname:           null,
        },
    }));
    assertValid(designWithConfigurations({}), "empty configurations");
    assertValid(designWithConfigurations({ "polyadic-devils-advocate": {} }),
        "empty service entry");
});

test("configurations of services that are not enabled stay valid", () => {
    assertValid(designWithConfigurations({
        "argumentation-tutor-system": { llm_tier: "advanced" },
    }));
});

test("configurations reject non-scalar values", () => {
    for (const value of [{ nested: true }, ["basic"], [], {}]) {
        assertInvalid(designWithConfigurations({
            "polyadic-devils-advocate": { llm_tier: value },
        }), JSON.stringify(value));
    }
});

test("configurations reject non-object service entries and empty keys", () => {
    for (const entry of ["basic", 3, null, ["basic"]]) {
        assertInvalid(designWithConfigurations({ "polyadic-devils-advocate": entry }),
            JSON.stringify(entry));
    }
    assertInvalid(designWithConfigurations({ "": { llm_tier: "basic" } }), "empty service id");
    assertInvalid(designWithConfigurations({ "polyadic-devils-advocate": { "": "basic" } }),
        "empty field key");
    assertInvalid(designWithConfigurations(["polyadic-devils-advocate"]), "array");
});

// ─── grouping_algorithm ──────────────────────────────────────────────────────

test("grouping_algorithm accepts random and the editor's null, nothing else", () => {
    assertValid(designWithPhase(seedPhase({ grouping_algorithm: null })), "null");
    assertValid(designWithPhase(seedPhase({ mode: "team", grouping_algorithm: "random" })),
        "random");
    assertInvalid(designWithPhase(seedPhase({ grouping_algorithm: "alphabetical" })),
        "alphabetical");
});
