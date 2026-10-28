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
    });
    assert.deepEqual(dependencies.calls.explain,
        [{ producerId: "case-analyst-claim-typology", design: DESIGN }]);
    const [{ units: tutorUnits, caseId, designId }] = dependencies.calls.tutorModes;
    assert.deepEqual(tutorUnits.map(unit => unit.id), ["p2-q1"],
        "only the questions of the tutor's phases get a tutor mode");
    assert.equal(caseId, 34);
    assert.equal(designId, 12);
});

test("describeDesignAnalysisUnits: no tutor mode when the tutor is not a usable consumer", async () => {
    const dependencies = fakeDependencies({ units: [], reason: "consumers-unusable", consumerIds: [] });

    const described = await describeDesignAnalysisUnits(
        { serviceId: "case-analyst-claim-typology", designRow: DESIGN_ROW },
        dependencies
    );

    assert.deepEqual(described, { units: [], unitsReason: "consumers-unusable", tutorModes: {} });
    assert.deepEqual(dependencies.calls.tutorModes, []);
});
