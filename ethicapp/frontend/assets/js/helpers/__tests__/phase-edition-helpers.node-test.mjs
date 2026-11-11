import assert from "node:assert/strict";
import { describe, it } from "node:test";

import designEditActions from "../phase-edition-helpers.js";

describe("designEditActions.buildBlankPhase", () => {
    it("builds a ranking phase that can be added to the design", () => {
        const design = { type: "ranking", phases: [] };

        const phase = designEditActions.buildBlankPhase(design);
        designEditActions.addPhase(design, phase);

        assert.ok(phase, "the ranking builder returns its phase");
        assert.deepEqual(phase.roles, []);
        assert.equal(phase.randomize_item_order, false);
        assert.equal(phase.mode, "individual");
        assert.deepEqual(phase.externalServices, { enabledServiceIds: [], configurations: {} });
        assert.equal(design.phases.length, 1);
    });

    it("builds a semantic differential phase", () => {
        const phase = designEditActions.buildBlankPhase({ type: "semantic_differential" });

        assert.equal(phase.mode, "individual");
        assert.deepEqual(phase.prevPhasesResponse, []);
    });

    it("builds new phases without a duration (#1107)", () => {
        for (const type of ["semantic_differential", "ranking"]) {
            const phase = designEditActions.buildBlankPhase({ type });
            assert.equal(Object.hasOwn(phase, "durationMinutes"), false, type);
        }
    });
});

describe("phase durations through edition actions (#1107)", () => {
    it("duplicating a phase keeps its duration, independently of the source", () => {
        const design = {
            type:   "semantic_differential",
            phases: [{ mode: "individual", durationMinutes: 25 }, { mode: "individual" }],
        };

        designEditActions.clonePhaseByIndex(design, 0);

        assert.equal(design.phases.length, 3);
        assert.equal(design.phases[1].durationMinutes, 25);
        design.phases[1].durationMinutes = 5;
        assert.equal(design.phases[0].durationMinutes, 25);
        assert.equal(Object.hasOwn(design.phases[2], "durationMinutes"), false);
    });

    it("changing the phase mode keeps its duration", () => {
        const phase = { mode: "team", durationMinutes: 30 };

        designEditActions.updatePhaseType(phase);
        assert.equal(phase.durationMinutes, 30);

        phase.mode = "individual";
        designEditActions.updatePhaseType(phase);
        assert.equal(phase.durationMinutes, 30);
    });
});
