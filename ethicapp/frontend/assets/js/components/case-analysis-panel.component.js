// The content of one analysis tab in the case view (#651). It exists only
// while its tab is open, so the analysis document is read only then. It shows
// the status and the latest error, offers "Generate again" with a
// confirmation, and renders the document with the component registered for
// the service (see case-analysis-component-host) or with a generic read-only
// view.

import {
    canRegenerateCaseAnalysis,
    caseAnalysisChanged,
    caseAnalysisErrorKey,
    caseAnalysisIndicator,
    caseAnalysisState,
    genericCaseAnalysisFields,
    hasLatestGenerationFailed,
    resolveCaseAnalysisComponent,
} from "../helpers/case-analyses.js";

const GENERATE_NOTICES = Object.freeze({
    busy:     { type: "warning", key: "case_analysis_generate_busy" },
    disabled: { type: "warning", key: "case_analysis_generate_disabled" },
    error:    { type: "danger", key: "case_analysis_generate_failed" },
});

function CaseAnalysisPanelController($scope, CaseAnalysesService) {
    const vm = this;
    let destroyed = false;
    let loadSequence = 0;

    vm.detail = null;
    vm.loading = false;
    vm.loadFailed = false;
    vm.confirmingGenerate = false;
    vm.generating = false;
    vm.notice = null;
    vm.genericFields = [];

    vm.$onChanges = function(changes) {
        if (changes.summary && caseAnalysisChanged(vm.summary, vm.detail)) {
            vm.loadDetail();
        }
    };

    vm.$onDestroy = function() {
        destroyed = true;
    };

    vm.loadDetail = async function() {
        const caseId = vm.caseItem?.id;
        const serviceId = vm.summary?.serviceId;
        if (!caseId || !serviceId) {
            return;
        }

        const sequence = ++loadSequence;
        vm.loading = true;
        vm.loadFailed = false;

        try {
            const detail = await CaseAnalysesService.getAnalysis(caseId, serviceId);
            if (destroyed || sequence !== loadSequence) {
                return;
            }
            vm.detail = detail;
            vm.genericFields = genericCaseAnalysisFields(detail?.document);
        } catch (error) {
            if (destroyed || sequence !== loadSequence) {
                return;
            }
            console.error("[caseAnalysisPanel] Could not load the analysis.", error);
            vm.loadFailed = true;
        } finally {
            if (!destroyed && sequence === loadSequence) {
                vm.loading = false;
                $scope.$applyAsync();
            }
        }
    };

    // The listing is the source of truth for the status; the detail adds the
    // document, which may belong to a previous generation while a new one runs.
    vm.state = function() {
        return caseAnalysisState(vm.summary);
    };

    vm.indicator = function() {
        return caseAnalysisIndicator(vm.summary);
    };

    vm.latestGenerationFailed = function() {
        return hasLatestGenerationFailed(vm.summary);
    };

    vm.errorKey = function() {
        return caseAnalysisErrorKey(vm.summary?.errorCode);
    };

    vm.errorMessage = function() {
        return vm.summary?.errorMessage || "";
    };

    vm.hasDocument = function() {
        const document = vm.detail?.document;
        return document !== null && document !== undefined;
    };

    vm.componentName = function() {
        return vm.summary?.ui?.component ?? null;
    };

    vm.hasRegisteredComponent = function() {
        return resolveCaseAnalysisComponent(vm.componentName()) !== null;
    };

    vm.canGenerate = function() {
        return canRegenerateCaseAnalysis(vm.summary) && !vm.generating;
    };

    vm.isServiceUnavailable = function() {
        return vm.summary?.usable !== true;
    };

    vm.askToGenerate = function() {
        vm.notice = null;
        vm.confirmingGenerate = true;
    };

    vm.cancelGenerate = function() {
        vm.confirmingGenerate = false;
    };

    vm.confirmGenerate = async function() {
        const caseId = vm.caseItem?.id;
        const serviceId = vm.summary?.serviceId;
        if (!caseId || !serviceId || vm.generating) {
            return;
        }

        vm.confirmingGenerate = false;
        vm.generating = true;
        vm.notice = null;

        try {
            const { outcome, analysis } = await CaseAnalysesService
                .generateAnalysis(caseId, serviceId);
            if (destroyed) {
                return;
            }
            if (outcome === "accepted") {
                vm.onAnalysisChanged({ analysis });
            } else {
                vm.notice = GENERATE_NOTICES[outcome] || GENERATE_NOTICES.error;
                // Another tab or a teacher may have changed it: show the current state.
                vm.onRefreshRequested();
            }
        } catch (error) {
            console.error("[caseAnalysisPanel] Could not request a new generation.", error);
            if (!destroyed) {
                vm.notice = GENERATE_NOTICES.error;
            }
        } finally {
            if (!destroyed) {
                vm.generating = false;
                $scope.$applyAsync();
            }
        }
    };

    // A registered component stored an edit: keep its document and update the tab.
    vm.handleAnalysisUpdated = function(analysis) {
        if (!analysis) {
            return;
        }
        vm.detail = analysis;
        vm.genericFields = genericCaseAnalysisFields(analysis.document);
        vm.onAnalysisChanged({ analysis });
    };
}

export default {
    bindings: {
        caseItem:           "<",
        summary:            "<",
        onAnalysisChanged:  "&",
        onRefreshRequested: "&",
    },
    controller:  ["$scope", "CaseAnalysesService", CaseAnalysisPanelController],
    templateUrl: "/assets/static/views/teacher/fragments/case-analysis-panel.template.html",
};
