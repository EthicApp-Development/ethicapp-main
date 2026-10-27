// The view of the development analysis `mock-case-analysis`
// (document `mock-case-analysis/v1`: word count, character count and an
// excerpt of the case text). It is the reference for the components that
// case analysis tabs compile by `ui.component` (#651); see
// helpers/case-analyses.js.

function MockCaseAnalysisViewController() {
    const vm = this;

    vm.document = function() {
        const document = vm.analysis?.document;
        return document && typeof document === "object" ? document : {};
    };
}

export default {
    bindings: {
        analysis:          "<",
        caseItem:          "<",
        onAnalysisUpdated: "&",
    },
    controller:  MockCaseAnalysisViewController,
    templateUrl: "/assets/static/views/teacher/fragments/mock-case-analysis-view.template.html",
};
