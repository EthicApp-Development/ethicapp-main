import assert from "node:assert/strict";
import test from "node:test";

import { describeDesignAnalysisUnits } from "../design-analysis-view.js";

const TUTOR_ID = "argumentation-tutor-system";

const DESIGN = Object.freeze({
    type:   "semantic_differential",
    phases: [
        { externalServices: { enabledServiceIds: ["other-consumer"] }, questions: [{ q_text: "Other?" }] },
        { externalServices: { enabledServiceIds: [TUTOR_ID] }, questions: [{ q_text: "Tutor?" }] },
    ],
});
const DESIGN_ROW = Object.freeze({ id: 12, case_id: 34, design: DESIGN });

function fakeDependencies(explained) {
    const calls = { explain: [], tutorModes: [] };
    return {
        calls,
        explainUnits: async (args) => {
            calls.explain.push(args);
            return explained;
        },
        tutorModes: async (args) => {
            calls.tutorModes.push(args);
            return Object.fromEntries(args.units.map(unit => [unit.id, { mode: "basic", reason: "no-inventory" }]));
        },
    };
}

test("describeDesignAnalysisUnits: the selected units and the tutor questions' expected modes", async () => {
    const units = [{ id: "p1-q1" }, { id: "p2-q1" }];
    const dependencies = fakeDependencies({ units, reason: null, consumerIds: ["other-consumer", TUTOR_ID] });

    const described = await describeDesignAnalysisUnits(
        { serviceId: "case-analyst-claim-typology", designRow: DESIGN_ROW },
        dependencies
    );

    assert.deepEqual(described, {
        units,
        unitsReason: null,
        tutorModes:  { "p2-q1": { mode: "basic", reason: "no-inventory" } },
        tutorPhases: [{ phaseNumber: 2, requestedMode: "enhanced", reason: null }],
    });
    assert.deepEqual(dependencies.calls.explain,
        [{ producerId: "case-analyst-claim-typology", design: DESIGN }]);
    const [{ units: tutorUnits, design, caseId, designId }] = dependencies.calls.tutorModes;
    assert.deepEqual(tutorUnits.map(unit => unit.id), ["p2-q1"],
        "only the questions of the tutor's phases get a tutor mode");
    assert.equal(design, DESIGN, "the design gives each phase's requested mode");
    assert.equal(caseId, 34);
    assert.equal(designId, 12);
});

// A design with a basic tutor phase and an enhanced one (#870): the typology
// covers the enhanced phase only, and the view says why the other has none.
test("describeDesignAnalysisUnits: a basic tutor phase is listed with basic-selected, not as a unit", async () => {
    const tutorPhase = (configuration, text) => ({
        externalServices: {
            enabledServiceIds: [TUTOR_ID],
            ...(configuration ? { configurations: { [TUTOR_ID]: configuration } } : {}),
        },
        questions: [{ q_text: text }],
    });
    const design = {
        type:   "semantic_differential",
        phases: [tutorPhase({ evaluation_mode: "basic" }, "Basic?"), tutorPhase(null, "Enhanced?")],
    };
    const registry = {
        getDesignAnalysisConsumerIds: () => [TUTOR_ID],
        usableServiceIds:             async serviceIds => serviceIds,
        consumerNeedsDesignAnalysis:  (serviceId, { configuration }) => configuration.evaluation_mode !== "basic",
    };
    const tutorModes = async ({ units }) => Object.fromEntries(units.map(unit => [unit.id, unit.phaseNumber]));

    const described = await describeDesignAnalysisUnits(
        { serviceId: "case-analyst-claim-typology", designRow: { id: 12, case_id: 34, design } },
        { registry, tutorModes }
    );

    assert.deepEqual(described.units.map(unit => unit.id), ["p2-q1"]);
    assert.equal(described.unitsReason, null);
    assert.deepEqual(described.tutorModes, { "p1-q1": 1, "p2-q1": 2 },
        "every tutor question has an expected mode, basic-selected ones included");
    assert.deepEqual(described.tutorPhases, [
        { phaseNumber: 1, requestedMode: "basic", reason: "basic-selected" },
        { phaseNumber: 2, requestedMode: "enhanced", reason: null },
    ]);
});

test("describeDesignAnalysisUnits: no tutor mode when the tutor is not a usable consumer", async () => {
    const dependencies = fakeDependencies({ units: [], reason: "consumers-unusable", consumerIds: [] });

    const described = await describeDesignAnalysisUnits(
        { serviceId: "case-analyst-claim-typology", designRow: DESIGN_ROW },
        dependencies
    );

    assert.deepEqual(described, {
        units:       [],
        unitsReason: "consumers-unusable",
        tutorModes:  {},
        tutorPhases: [],
    });
    assert.deepEqual(dependencies.calls.tutorModes, []);
});
