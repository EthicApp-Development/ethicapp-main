import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseEvaluationViewComponent from "../case-evaluation-view.component.js";

const CaseEvaluationViewController = caseEvaluationViewComponent.controller;

describe("case-evaluation-view", () => {
    it("takes the bindings of an analysis tab component", () => {
        assert.deepEqual(caseEvaluationViewComponent.bindings, {
            analysis:          "<",
            caseItem:          "<",
            onAnalysisUpdated: "&",
        });
    });

    it("rebuilds the view when another analysis arrives", () => {
        const vm = new CaseEvaluationViewController();
        assert.deepEqual(vm.view.issues, []);

        vm.analysis = {
            serviceId: "case-analyst-evaluation",
            document:  {
                synthesis: {
                    selectedIssues: [],
                    finalFeedback:  { summary: "A clear case.", recommendations: [] },
                },
                evaluations: [],
            },
        };
        vm.$onChanges({ analysis: { currentValue: vm.analysis } });

        assert.equal(vm.view.summary, "A clear case.");

        vm.analysis = { serviceId: "case-analyst-evaluation", document: null };
        vm.$onChanges({ analysis: { currentValue: vm.analysis } });

        assert.equal(vm.view.summary, "");
    });
});
