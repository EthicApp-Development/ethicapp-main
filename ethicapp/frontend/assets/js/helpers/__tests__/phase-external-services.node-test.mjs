import assert from "node:assert/strict";
import { describe, it } from "node:test";

import designEditActions from "../phase-edition-helpers.js";
import {
    emptyExternalServicesConfig,
    normalizeExternalServicesConfig,
} from "../phase-external-services.js";

const EMPTY = Object.freeze({ enabledServiceIds: [], configurations: {} });

const CONFIGURATIONS = Object.freeze({
    "polyadic-devils-advocate": { pipeline_type: "devilsAdvocate", llm_tier: "basic" },
});

describe("phase external services (#729)", () => {
    it("starts empty, with configurations", () => {
        assert.deepEqual(emptyExternalServicesConfig(), EMPTY);
        assert.notEqual(emptyExternalServicesConfig(), emptyExternalServicesConfig());
    });

    it("fills in a missing or malformed shape", () => {
        const malformed = [
            undefined, null, [], "x", { enabledServiceIds: "x", configurations: [] },
        ];
        for (const externalServices of malformed) {
            const phase = { externalServices };
            normalizeExternalServicesConfig(phase);
            assert.deepEqual(phase.externalServices, EMPTY, JSON.stringify(externalServices));
        }
    });

    it("adds configurations to designs saved before they existed", () => {
        const phase = { externalServices: { enabledServiceIds: ["mock-chat-agent"] } };

        const result = normalizeExternalServicesConfig(phase);

        assert.equal(result, phase.externalServices);
        assert.deepEqual(phase.externalServices,
            { enabledServiceIds: ["mock-chat-agent"], configurations: {} });
    });

    it("keeps configurations, including those of services that are not enabled", () => {
        const phase = {
            externalServices: {
                enabledServiceIds: [],
                configurations:    structuredClone(CONFIGURATIONS),
                futureKey:         true,
            },
        };

        normalizeExternalServicesConfig(phase);

        assert.deepEqual(phase.externalServices.configurations, CONFIGURATIONS);
        assert.equal(phase.externalServices.futureKey, true);
    });

    it("initializes phases the editor creates or opens", () => {
        const blank = designEditActions.buildBlankPhase({ type: "semantic_differential" });
        assert.deepEqual(blank.externalServices, EMPTY);

        const opened = { mode: "individual", externalServices: { enabledServiceIds: ["svc"] } };
        designEditActions.initPhase(opened);
        assert.deepEqual(opened.externalServices, { ...EMPTY, enabledServiceIds: ["svc"] });
    });

    it("cloning a phase copies its configurations without sharing them", () => {
        const design = {
            type:   "semantic_differential",
            phases: [{
                externalServices: {
                    enabledServiceIds: ["polyadic-devils-advocate"],
                    configurations:    structuredClone(CONFIGURATIONS),
                },
            }],
        };

        designEditActions.clonePhaseByIndex(design, 0);
        const [original, clone] = design.phases.map(phase => phase.externalServices.configurations);
        clone["polyadic-devils-advocate"].llm_tier = "advanced";

        assert.equal(original["polyadic-devils-advocate"].llm_tier, "basic");
    });
});
