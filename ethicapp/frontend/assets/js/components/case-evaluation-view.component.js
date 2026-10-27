// The read-only view of the Case Analyst case evaluation (#844), document
// `case-evaluation/v1`: the final feedback and the issues worth revising
// first, then the feedback of each evaluator, criterion by criterion.
// Compiled for analysis tabs through CASE_ANALYSIS_COMPONENTS
// (helpers/case-analyses.js).

import { buildCaseEvaluationView } from "../helpers/case-evaluation.js";

function CaseEvaluationViewController() {
    const vm = this;

    vm.view = buildCaseEvaluationView(null);

    vm.$onChanges = function(changes) {
        if (changes.analysis) {
            vm.view = buildCaseEvaluationView(vm.analysis?.document ?? null);
        }
    };
}

export default {
    bindings: {
        analysis:          "<",
        caseItem:          "<",
        onAnalysisUpdated: "&",
    },
    controller:  CaseEvaluationViewController,
    templateUrl: "/assets/static/views/teacher/fragments/case-evaluation-view.template.html",
};
