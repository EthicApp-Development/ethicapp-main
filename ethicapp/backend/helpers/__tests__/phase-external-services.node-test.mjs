import assert from "node:assert/strict";
import test from "node:test";
import { phaseExternalServices, unionEnabledServiceIds } from "../phase-external-services.js";

test("phaseExternalServices: enabled ids with their stored configurations (#734)", () => {
    const phase = {
        externalServices: {
            enabledServiceIds: [
                " polyadic-devils-advocate ", "mock-chat-agent", "polyadic-devils-advocate",
            ],
            configurations: {
                "polyadic-devils-advocate":   { llm_tier: "advanced", pipeline_type: "toulmin" },
                "argumentation-tutor-system": { llm_tier: "basic" },
            },
        },
    };

    assert.deepEqual(phaseExternalServices(phase), {
        enabledServiceIds: ["polyadic-devils-advocate", "mock-chat-agent"],
        configurations:    {
            "polyadic-devils-advocate": { llm_tier: "advanced", pipeline_type: "toulmin" },
        },
    });
});

test("phaseExternalServices: configurations are copies", () => {
    const stored = { llm_tier: "advanced" };
    const phase = {
        externalServices: { enabledServiceIds: ["svc"], configurations: { svc: stored } },
    };

    phaseExternalServices(phase).configurations.svc.llm_tier = "basic";

    assert.equal(stored.llm_tier, "advanced");
});

test("phaseExternalServices: missing or malformed parts give empty results", () => {
    const empty = { enabledServiceIds: [], configurations: {} };
    const phases = [undefined, null, {}, { externalServices: null }, { externalServices: [] }];
    for (const phase of phases) {
        assert.deepEqual(phaseExternalServices(phase), empty, JSON.stringify(phase));
    }

    const malformed = {
        externalServices: {
            enabledServiceIds: ["svc", "", "  ", 7],
            configurations:    { svc: ["not", "an", "object"], 7: { a: 1 } },
        },
    };
    assert.deepEqual(phaseExternalServices(malformed),
        { enabledServiceIds: ["svc", "7"], configurations: { 7: { a: 1 } } });
});

test("unionEnabledServiceIds: unions, trims and de-duplicates across phases", () => {
    const phases = [
        { externalServices: { enabledServiceIds: ["a", " b "] } },
        {},
        { externalServices: { enabledServiceIds: ["b", "c"] } },
    ];

    assert.deepEqual(unionEnabledServiceIds(phases), ["a", "b", "c"]);
    assert.deepEqual(unionEnabledServiceIds(null), []);
});
